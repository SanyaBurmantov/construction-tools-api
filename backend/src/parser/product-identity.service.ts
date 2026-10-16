import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../common/utils/upsert-tolerantly';
import { generateSlug } from '../common/utils/generate-slug';
import { shouldBeFilterable } from './spec-filterable';
import { canonicalSpec, normalizeSpecValue } from './spec-canonical';
import { cleanProductTexts } from './supplier-text';
import { normalizeBrandName } from './brand-name';

/** How many `-2`, `-3`… suffixes to try before giving up on a slug. */
const MAX_SLUG_ATTEMPTS = 50;

/**
 * Columns a parse never writes, whatever the parser passes:
 * - prices belong to PricingService (`applyCost` after the offer is saved) —
 *   a parser writing them clobbered MANUAL prices and published new products
 *   at the raw supplier cost;
 * - status belongs to the publication rules in OffersService and to admins —
 *   a parse must not republish what someone hid.
 */
const PARSER_FORBIDDEN_FIELDS = [
  'priceValue',
  'oldPrice',
  'costPrice',
  'pricingMode',
  'status',
  'statusSource',
  'aiLockedFields',
  'lockedFields',
] as const;

export type ProductWriteData = {
  // Unchecked variants: the parsers set foreign keys directly (`brandId`,
  // `categoryId`) rather than through nested connects.
  update: Prisma.ProductUncheckedUpdateInput;
  create: Prisma.ProductUncheckedCreateInput;
};

/**
 * Saves a parsed product, fixing two failure modes the per-parser
 * `product.upsert({ where: { slug } })` had.
 *
 * **1. Slug was identity.** Two different products whose names slugify the same
 * (common when the supplier gives no article number) silently overwrote each
 * other: the queue said DONE, the catalogue gained nothing. Identity is now the
 * supplier offer — `SourceProduct(sourceId, url)` — which is stable across
 * re-parses and follows the product if an admin merges duplicates. The slug is
 * only a public URL, and a new product that wants a taken one gets `-2`, `-3`…
 *
 * **2. Upsert is not atomic.** With nested writes (`images: { create }`) Prisma
 * cannot use `INSERT … ON CONFLICT`, so it reads then writes. Two workers in one
 * batch both saw "no such product" and both inserted — the loser got
 * `Unique constraint failed on the fields: (slug)`. Creates now retry on P2002.
 */
@Injectable()
export class ProductIdentityService {
  private readonly logger = new Logger(ProductIdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the product this supplier URL already belongs to, if any. This is
   * what makes re-parses idempotent without relying on the slug.
   */
  async findByOffer(sourceId: string, url: string) {
    const offer = await this.prisma.sourceProduct.findUnique({
      where: { sourceId_url: { sourceId, url } },
      select: { productId: true },
    });
    return offer?.productId ?? null;
  }

  /**
   * Update the product this offer already points at, or create a new one with a
   * free slug. `baseSlug` is the pretty candidate; it is used as-is when free.
   */
  async save(params: {
    sourceId: string;
    url: string;
    baseSlug: string;
    data: ProductWriteData;
  }) {
    // Every parser saves through here, so this is the one place a supplier's
    // sales boilerplate (their phone, «купить в Минске») is kept out of our
    // product text, whichever parser forgot to clean it.
    params = {
      ...params,
      data: this.withoutForbiddenFields(this.withCleanTexts(params.data)),
    };
    const existingId = await this.findByOffer(params.sourceId, params.url);

    if (existingId) {
      return this.prisma.product.update({
        where: { id: existingId },
        data: await this.withoutLockedFields(existingId, params.data.update),
      });
    }

    return this.createWithFreeSlug(params, params.data);
  }

  /**
   * Text an AI task rewrote (`aiLockedFields`) and fields an admin corrected
   * by hand (`lockedFields`) are ours now: the daily re-parse would otherwise
   * put the supplier's version back within 24 hours.
   */
  private async withoutLockedFields(
    productId: string,
    update: ProductWriteData['update'],
  ): Promise<ProductWriteData['update']> {
    const row = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { aiLockedFields: true, lockedFields: true },
    });
    const locked = [
      ...(row?.aiLockedFields ?? []),
      ...(row?.lockedFields ?? []),
    ];
    if (!locked.length) return update;
    const fields = { ...(update as Record<string, unknown>) };
    for (const key of locked) delete fields[key];
    return fields as ProductWriteData['update'];
  }

  /**
   * Enforced here rather than trusted to each parser: four parsers drifted,
   * and every one wrote `priceValue` on create.
   */
  private withoutForbiddenFields(data: ProductWriteData): ProductWriteData {
    const strip = <T extends object>(input: T): T => {
      const fields = { ...(input as Record<string, unknown>) };
      for (const key of PARSER_FORBIDDEN_FIELDS) delete fields[key];
      return fields as T;
    };
    return {
      update: strip(data.update),
      create: {
        ...strip(data.create),
        // Not on the storefront until PricingService has priced it and
        // OffersService publishes it — a half-saved product is invisible.
        status: 'DRAFT',
        statusSource: 'SYSTEM',
      },
    };
  }

  private withCleanTexts(data: ProductWriteData): ProductWriteData {
    const clean = <T extends object>(input: T): T => {
      const fields = input as Record<string, unknown>;
      const text = (key: string) =>
        typeof fields[key] === 'string' ? fields[key] : undefined;
      const patch = cleanProductTexts({
        name: text('name'),
        descriptionShort: text('descriptionShort'),
        descriptionFull: text('descriptionFull'),
        seoTitle: text('seoTitle'),
        seoDescription: text('seoDescription'),
      });
      return Object.keys(patch).length ? { ...input, ...patch } : input;
    };
    return { update: clean(data.update), create: clean(data.create) };
  }

  /**
   * Creates the product **together with** a stub of its SourceProduct, in one
   * transaction. The full offer row is written later in the parse (after
   * categories and specs); before, it was the only link from the URL to the
   * product, so any failure in between left a product no offer pointed at,
   * and the retry created another one as `slug-2`. With the stub committed
   * alongside, a retry finds the product through `findByOffer`. The stub has
   * no price, so it never counts as a live offer.
   */
  private async createWithFreeSlug(
    params: { sourceId: string; url: string; baseSlug: string },
    data: ProductWriteData,
  ) {
    const base = params.baseSlug || 'product';

    for (let attempt = 0; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const id = randomUUID();

      // A product may already exist under this slug from an earlier run of a
      // *different* supplier URL. That is a genuine second product, so it gets
      // its own slug rather than overwriting the first.
      try {
        const [created] = await this.prisma.$transaction([
          this.prisma.product.create({ data: { ...data.create, id, slug } }),
          this.prisma.sourceProduct.upsert({
            where: {
              sourceId_url: { sourceId: params.sourceId, url: params.url },
            },
            create: {
              sourceId: params.sourceId,
              url: params.url,
              externalId: params.url,
              name: String(data.create.name),
              price: null,
              stock: false,
              images: [],
              specifications: {},
              productId: id,
            },
            // A row left with `productId: null` (its product was deleted
            // before soft-delete existed) is re-linked to the new product.
            update: { productId: id },
          }),
        ]);

        if (attempt > 0) {
          this.logger.debug(
            `Slug "${base}" was taken; created "${slug}" instead`,
          );
        }
        return created;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // A concurrent worker may have just created this very offer's
        // product; use it rather than minting a duplicate.
        const raced = await this.findByOffer(params.sourceId, params.url);
        if (raced) {
          return this.prisma.product.update({
            where: { id: raced },
            data: await this.withoutLockedFields(raced, data.update),
          });
        }
        // Slug taken — next candidate.
      }
    }

    throw new Error(`Could not find a free product slug for "${base}"`);
  }

  /**
   * Brand upsert that tolerates two workers creating the same brand at once.
   * Returns undefined for names that slugify to nothing, and for supplier
   * values that are not a brand at all («без товарного знака», «запчасти…»,
   * «Измерители» — see `brand-name.ts`): such a product gets no brand rather
   * than a bogus brand page.
   *
   * Case-variant spellings («MAKITA» / «Makita») resolve to one row because
   * the lookup is by slug, which is lowercase; the first spelling seen stays.
   */
  async upsertBrand(rawName: string) {
    const name = normalizeBrandName(rawName);
    if (!name) return undefined;
    const slug = generateSlug(name);
    if (!slug) return undefined;

    // A brand an admin merged away: its spelling now means the survivor.
    const alias = await this.prisma.brandAlias.findUnique({
      where: { slug },
      select: { brandId: true },
    });
    if (alias) return alias.brandId;

    try {
      const brand = await this.prisma.brand.upsert({
        where: { slug },
        update: {},
        create: { name, slug, seoTitle: name, seoDescription: name },
      });
      return brand.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const raced = await this.prisma.brand.findUnique({
        where: { slug },
        select: { id: true },
      });
      return raced?.id;
    }
  }

  /**
   * Writes a parsed product's characteristics.
   *
   * Every parser had its own copy of this loop. They are now one method, which
   * is also what guarantees the canonical identity and the normalized value are
   * written on *every* source — a parser that forgot either would quietly drop
   * its products out of the facets.
   */
  async saveSpecifications(
    specs: Array<{ name: string; value: string }>,
    productId: string,
    categoryId: string,
  ) {
    for (const spec of specs) {
      const key = generateSlug(spec.name);
      if (!key) continue;

      const specification = await this.upsertSpecification(
        categoryId,
        spec.name,
        key,
        spec.value,
      );
      if (!specification) continue;

      const { display, facet } = normalizeSpecValue(
        spec.value,
        specification.canonicalUnit ?? undefined,
      );

      const identity = {
        productId,
        specificationId: specification.id,
      };

      // A value that carries no information is not stored at all. Keeping it
      // would put a supplier's "-" or its impossible `Вес = "0 кг"` (6188
      // products had one) on the product page while the filter ignored it.
      // deleteMany, not delete: the row usually does not exist.
      if (facet === null) {
        await this.prisma.productSpecification.deleteMany({ where: identity });
        continue;
      }

      await this.prisma.productSpecification.upsert({
        where: { productId_specificationId: identity },
        update: { value: display, valueNorm: facet },
        create: { ...identity, value: display, valueNorm: facet },
      });
    }
  }

  /**
   * Same race, same fix, for `Specification(categoryId, key)`.
   *
   * `filterable` is decided once, when the spec first appears in a category —
   * see `shouldBeFilterable`. Existing specs keep whatever an admin set.
   *
   * The canonical columns are written on create *and* backfilled on update: the
   * normalizer cron needs them everywhere, and a row created before this
   * existed would otherwise never get them.
   */
  async upsertSpecification(
    categoryId: string,
    name: string,
    key: string,
    value?: string,
  ) {
    const canonical = canonicalSpec(name);
    const canonicalFields = canonical
      ? {
          canonicalKey: canonical.key,
          canonicalName: canonical.name,
          canonicalUnit: canonical.unit ?? null,
        }
      : {};

    try {
      return await this.prisma.specification.upsert({
        where: { categoryId_key: { categoryId, key } },
        // Only the canonical columns — `filterable` and `name` stay as an
        // admin left them.
        update: canonicalFields,
        create: {
          name,
          key,
          categoryId,
          filterable: shouldBeFilterable(name, value),
          ...canonicalFields,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      return this.prisma.specification.findUnique({
        where: { categoryId_key: { categoryId, key } },
      });
    }
  }
}
