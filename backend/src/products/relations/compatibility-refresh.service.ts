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
import { RELATION_IDENTITY_SELECT } from './relation-select';

// v2: rule 2 starts its own pass instead of resuming rule 1's cursor.
const CURSOR_KEY = 'productRelations.cursor.v2';
/** Most products are not accessories and cost a regex, not a query. */
const BATCH_SIZE = 200;
const MAX_CANDIDATES = 1000;

type Accessory = RelationIdentity & { sourceName?: string | null };

/**
 * Bounded rolling sweep in the worker: 200 products every 30 s, so ~85k
 * products are re-read every ~3.5 h with no catalogue-sized heap and no work
 * in HTTP requests. Nobody has to start it.
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
      const matcher = await this.brandMatcher();
      const sourceNames = await this.sourceNames(
        rows.filter((row) => row.aiLockedFields.includes('name')),
      );
      let links = 0;
      const idle: string[] = [];
      for (const row of rows) {
        const accessory = { ...row, sourceName: sourceNames.get(row.id) };
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

  /** The owning (oldest) offer's name: the supplier's words under an AI name. */
  private async sourceNames(rows: Array<{ id: string }>) {
    const names = new Map<string, string>();
    if (!rows.length) return names;
    const offers = await this.prisma.sourceProduct.findMany({
      where: { productId: { in: rows.map((row) => row.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { productId: true, name: true },
    });
    for (const offer of offers)
      if (offer.productId && !names.has(offer.productId))
        names.set(offer.productId, offer.name);
    return names;
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
