import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { runsBackgroundJobs } from '../../common/utils/process-role';
import {
  COMPATIBILITY_RULE_VERSION,
  FOLD_FROM,
  FOLD_TO,
  MAX_LINKS,
  accessorySignature,
  createBrandMatcher,
  extractModelReferences,
  matchReference,
  ownModelCodes,
  referencePattern,
  targetSignature,
  type BrandMatcher,
  type ModelReference,
  type RelationBrand,
  type RelationIdentity,
  type TargetIdentity,
} from './compatibility';
import {
  FITMENT_RULE_VERSION,
  FITMENT_SPEC_KEYS,
  fitmentTags,
} from './fitment';
import { RELATION_IDENTITY_SELECT } from './relation-select';
import { parsePack } from './packs';
import { VARIANT_RULE_VERSION, productFamily } from './variants';

// Any rule change starts a pass from the beginning instead of resuming the
// previous rules' cursor; until it reaches a product, reads show that
// product's previous rows (each product's rows are replaced whole).
const CURSOR_KEY = `productRelations.cursor.c${COMPATIBILITY_RULE_VERSION}.f${FITMENT_RULE_VERSION}.v${VARIANT_RULE_VERSION}`;
/** Most products are not accessories and cost a regex, not a query. */
const BATCH_SIZE = 200;
const MAX_CANDIDATES = 1000;
// Products whose text changed (AI task, admin, supplier) since this moment.
const CHANGED_KEY = 'productRelations.changedSince.v2';
const CHANGED_BATCH = 100;

type Accessory = RelationIdentity & {
  sourceName?: string | null;
  sourceDescription?: string | null;
};
const TEXT_FIELDS = ['name', 'descriptionShort', 'descriptionFull'];

/**
 * Bounded rolling sweep in the worker: 200 products every 30 s, so ~85k
 * products are re-read every ~3.5 h with no catalogue-sized heap and no work
 * in HTTP requests. Nobody has to start it.
 *
 * Before the sweep, each tick takes the products whose text changed
 * (`contentUpdatedAt` — an AI task, an admin, a supplier rewrite) and the
 * accessories linked to them: an edit hides a link at once (signatures), and
 * this brings it back within a tick instead of a whole pass.
 */
@Injectable()
export class CompatibilityRefreshService {
  private readonly logger = new Logger(CompatibilityRefreshService.name);
  private running = false;
  private brands?: { expires: number; matcher: BrandMatcher };

  constructor(private readonly prisma: PrismaService) {}

  @Interval(30_000)
  async refresh(): Promise<number> {
    if (!runsBackgroundJobs() || this.running) return 0;
    this.running = true;
    try {
      const matcher = await this.brandMatcher();
      // A failure here must not stall the sweep, which is also its backstop.
      let links = await this.refreshChanged(matcher).catch((error: unknown) => {
        this.logger.error(
          `Changed-products refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 0;
      });
      const cursor = await this.prisma.siteSetting.findUnique({
        where: { key: CURSOR_KEY },
      });
      const rows = await this.prisma.product.findMany({
        where: {
          status: 'PUBLISHED',
          ...(cursor?.value ? { id: { gt: cursor.value } } : {}),
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: RELATION_IDENTITY_SELECT,
      });
      links += await this.refreshRows(rows, matcher);
      await this.prisma.siteSetting.upsert({
        where: { key: CURSOR_KEY },
        create: { key: CURSOR_KEY, value: rows.at(-1)?.id ?? '' },
        update: { value: rows.at(-1)?.id ?? '' },
      });
      // End of a pass: reclaim rows reads would never show anyway — hidden or
      // archived products and links of an older rule. Deletion is the FKs'.
      if (!rows.length) {
        await this.prisma.productCompatibility.deleteMany({
          where: {
            OR: [
              { ruleVersion: { not: COMPATIBILITY_RULE_VERSION } },
              { accessory: { status: { not: 'PUBLISHED' } } },
              { product: { status: { not: 'PUBLISHED' } } },
            ],
          },
        });
        await this.prisma.productFitment.deleteMany({
          where: {
            OR: [
              { ruleVersion: { not: FITMENT_RULE_VERSION } },
              { product: { status: { not: 'PUBLISHED' } } },
            ],
          },
        });
        await this.prisma.productFamily.deleteMany({
          where: {
            OR: [
              { ruleVersion: { not: VARIANT_RULE_VERSION } },
              { product: { status: { not: 'PUBLISHED' } } },
            ],
          },
        });
      }
      return links;
    } catch (error) {
      this.logger.error(
        `Compatibility refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Products edited since the checkpoint, plus accessories pointing at them. */
  private async refreshChanged(matcher: BrandMatcher): Promise<number> {
    const checkpoint = await this.prisma.siteSetting.findUnique({
      where: { key: CHANGED_KEY },
    });
    // Keyset (time, id): a bulk update stamps many rows with one millisecond,
    // and a time-only checkpoint skipped all of them past the first batch.
    const [at, lastId = ''] = (checkpoint?.value ?? '').split('|');
    const since = new Date(at);
    if (!checkpoint || Number.isNaN(since.getTime())) {
      // First run: history is the sweep's job.
      await this.saveSetting(CHANGED_KEY, `${new Date().toISOString()}|`);
      return 0;
    }
    const changed = await this.prisma.product.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [
          { contentUpdatedAt: { gt: since } },
          { contentUpdatedAt: since, id: { gt: lastId } },
        ],
      },
      orderBy: [{ contentUpdatedAt: 'asc' }, { id: 'asc' }],
      take: CHANGED_BATCH,
      select: { ...RELATION_IDENTITY_SELECT, contentUpdatedAt: true },
    });
    if (!changed.length) return 0;
    const linked = await this.prisma.productCompatibility.findMany({
      where: {
        productId: { in: changed.map((row) => row.id) },
        accessoryId: { notIn: changed.map((row) => row.id) },
      },
      select: { accessoryId: true },
      distinct: ['accessoryId'],
    });
    const accessories = linked.length
      ? await this.prisma.product.findMany({
          where: {
            id: { in: linked.map((row) => row.accessoryId) },
            status: 'PUBLISHED',
          },
          select: RELATION_IDENTITY_SELECT,
        })
      : [];
    const links = await this.refreshRows(
      [
        ...changed.map(({ contentUpdatedAt: _, ...row }) => row),
        ...accessories,
      ],
      matcher,
    );
    const last = changed.at(-1)!;
    await this.saveSetting(
      CHANGED_KEY,
      `${last.contentUpdatedAt.toISOString()}|${last.id}`,
    );
    return links;
  }

  private async refreshRows(
    rows: RelationIdentity[],
    matcher: BrandMatcher,
  ): Promise<number> {
    const sources = await this.sourceTexts(
      rows.filter((row) =>
        TEXT_FIELDS.some((field) => row.aiLockedFields.includes(field)),
      ),
    );
    let links = 0;
    const idle: string[] = [];
    for (const row of rows) {
      const source = sources.get(row.id);
      const accessory = {
        ...row,
        sourceName: source?.name,
        sourceDescription: source?.description,
      };
      const references = extractModelReferences(accessory, matcher);
      if (references.length)
        links += await this.replaceLinks(accessory, references, matcher);
      else idle.push(row.id);
    }
    // Not (or no longer) an accessory: one statement for the whole batch.
    if (idle.length)
      await this.prisma.productCompatibility.deleteMany({
        where: { accessoryId: { in: idle } },
      });
    await this.refreshFitments(rows.map((row) => row.id));
    return links;
  }

  /**
   * A batch's own-name derivations, replaced in one go: standard-based tags
   * (fitment.ts) and the size-variant family (variants.ts).
   */
  async refreshFitments(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        brandId: true,
        categoryId: true,
        aiLockedFields: true,
        variantLine: true,
        brand: { select: { name: true } },
        productSpecs: {
          where: {
            specification: { canonicalKey: { in: FITMENT_SPEC_KEYS } },
          },
          select: {
            value: true,
            specification: { select: { canonicalKey: true } },
          },
        },
      },
    });
    const data = products.flatMap((product) =>
      fitmentTags({
        name: product.name,
        brandName: product.brand?.name,
        specs: Object.fromEntries(
          product.productSpecs.map((spec) => [
            spec.specification.canonicalKey ?? '',
            spec.value,
          ]),
        ),
      }).map((tag) => ({
        productId: product.id,
        key: tag.key,
        role: tag.role,
        ruleVersion: FITMENT_RULE_VERSION,
      })),
    );
    // An AI-renamed card keeps its line by the supplier's name.
    const sources = await this.sourceTexts(
      products.filter((product) => product.aiLockedFields.includes('name')),
    );
    const families = products.flatMap((product) => {
      const family = productFamily({
        ...product,
        sourceName: sources.get(product.id)?.name,
      });
      // A row also carries the name packs are read from.
      return family.familyKey || parsePack(family.keyName)
        ? [
            {
              productId: product.id,
              familyKey: family.familyKey,
              keyName: family.keyName,
              manual:
                Boolean(product.variantLine?.trim()) &&
                Boolean(family.familyKey),
              ruleVersion: VARIANT_RULE_VERSION,
            },
          ]
        : [];
    });
    await this.prisma.$transaction([
      this.prisma.productFitment.deleteMany({
        where: { productId: { in: ids } },
      }),
      this.prisma.productFitment.createMany({ data, skipDuplicates: true }),
      this.prisma.productFamily.deleteMany({
        where: { productId: { in: ids } },
      }),
      this.prisma.productFamily.createMany({
        data: families,
        skipDuplicates: true,
      }),
    ]);
  }

  private saveSetting(key: string, value: string) {
    return this.prisma.siteSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  /** Rebuilds one product's links as an accessory. */
  async refreshProduct(
    product: Accessory,
    brands: RelationBrand[] | BrandMatcher,
  ): Promise<number> {
    const matcher = Array.isArray(brands) ? createBrandMatcher(brands) : brands;
    const references = extractModelReferences(product, matcher);
    if (!references.length) {
      await this.prisma.productCompatibility.deleteMany({
        where: { accessoryId: product.id },
      });
      return 0;
    }
    return this.replaceLinks(product, references, matcher);
  }

  private async replaceLinks(
    product: Accessory,
    references: ModelReference[],
    matcher: BrandMatcher,
  ): Promise<number> {
    const data: Prisma.ProductCompatibilityCreateManyInput[] = [];
    const signature = accessorySignature(product);
    for (const reference of references) {
      if (data.length >= MAX_LINKS) break;
      for (const target of await this.targets(product.id, reference, matcher)) {
        if (data.length >= MAX_LINKS) break;
        if (data.some((row) => row.productId === target.id)) continue;
        data.push({
          accessoryId: product.id,
          productId: target.id,
          accessorySignature: signature,
          productSignature: targetSignature(target),
          modelCode: reference.codes[0],
          evidenceField: reference.field,
          ruleVersion: COMPATIBILITY_RULE_VERSION,
        });
      }
    }
    // A racing parser edit can make these snapshots stale; signatures on the
    // read side hide them at once. Replace atomically.
    await this.prisma.$transaction([
      this.prisma.productCompatibility.deleteMany({
        where: { accessoryId: product.id },
      }),
      this.prisma.productCompatibility.createMany({
        data,
        skipDuplicates: true,
      }),
    ]);
    return data.length;
  }

  /** Same-brand products spelling the model, then the exact rule in code. */
  private async targets(
    accessoryId: string,
    reference: ModelReference,
    matcher: BrandMatcher,
  ): Promise<TargetIdentity[]> {
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Product"
      WHERE "brandId" = ${reference.brandId} AND "status" = 'PUBLISHED'
        AND "id" <> ${accessoryId}
        AND translate(upper(concat_ws(' ', "name", "sku", "model")), ${FOLD_FROM}, ${FOLD_TO})
          LIKE ${referencePattern(reference)}
      LIMIT ${MAX_CANDIDATES}`;
    if (!ids.length) return [];
    const candidates = await this.prisma.product.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      select: { id: true, name: true, brandId: true, model: true, sku: true },
    });
    return matchReference(
      reference,
      candidates.map((target) => ({
        target,
        codes: ownModelCodes(target, matcher.name(target.brandId)),
      })),
    );
  }

  /** The owning (oldest) offer's text: the supplier's words under AI text. */
  private async sourceTexts(rows: Array<{ id: string }>) {
    const texts = new Map<
      string,
      { name: string; description: string | null }
    >();
    if (!rows.length) return texts;
    const offers = await this.prisma.sourceProduct.findMany({
      where: { productId: { in: rows.map((row) => row.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { productId: true, name: true, description: true },
    });
    for (const offer of offers)
      if (offer.productId && !texts.has(offer.productId))
        texts.set(offer.productId, {
          name: offer.name,
          description: offer.description,
        });
    return texts;
  }

  private async brandMatcher(): Promise<BrandMatcher> {
    if (!this.brands || this.brands.expires < Date.now()) {
      this.brands = {
        matcher: createBrandMatcher(
          await this.prisma.brand.findMany({
            select: { id: true, name: true },
          }),
        ),
        expires: Date.now() + 3_600_000,
      };
    }
    return this.brands.matcher;
  }
}
