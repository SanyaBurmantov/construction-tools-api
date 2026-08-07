import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateSlug } from '../common/utils/generate-slug';
import { shouldBeFilterable } from './spec-filterable';

/** How many `-2`, `-3`… suffixes to try before giving up on a slug. */
const MAX_SLUG_ATTEMPTS = 50;

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
    const existingId = await this.findByOffer(params.sourceId, params.url);

    if (existingId) {
      // Never republish something an admin hid or archived — the caller decides
      // whether to flip DRAFT→PUBLISHED and passes it in `update`.
      return this.prisma.product.update({
        where: { id: existingId },
        data: params.data.update,
      });
    }

    return this.createWithFreeSlug(params.baseSlug, params.data);
  }

  private async createWithFreeSlug(baseSlug: string, data: ProductWriteData) {
    const base = baseSlug || 'product';

    for (let attempt = 0; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;

      // A product may already exist under this slug from an earlier run of a
      // *different* supplier URL. That is a genuine second product, so it gets
      // its own slug rather than overwriting the first.
      try {
        const created = await this.prisma.product.create({
          data: { ...data.create, slug },
        });

        if (attempt > 0) {
          this.logger.debug(
            `Slug "${base}" was taken; created "${slug}" instead`,
          );
        }
        return created;
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
        // Taken (or lost a race against a concurrent worker) — next candidate.
      }
    }

    throw new Error(`Could not find a free product slug for "${base}"`);
  }

  /**
   * Brand upsert that tolerates two workers creating the same brand at once.
   * Returns undefined for names that slugify to nothing.
   */
  async upsertBrand(name: string) {
    const slug = generateSlug(name);
    if (!slug) return undefined;

    try {
      const brand = await this.prisma.brand.upsert({
        where: { slug },
        update: {},
        create: { name, slug, seoTitle: name, seoDescription: name },
      });
      return brand.id;
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;

      const raced = await this.prisma.brand.findUnique({
        where: { slug },
        select: { id: true },
      });
      return raced?.id;
    }
  }

  /**
   * Same race, same fix, for `Specification(categoryId, key)`.
   *
   * `filterable` is decided once, when the spec first appears in a category —
   * see `shouldBeFilterable`. Existing specs keep whatever an admin set.
   */
  async upsertSpecification(
    categoryId: string,
    name: string,
    key: string,
    value?: string,
  ) {
    try {
      return await this.prisma.specification.upsert({
        where: { categoryId_key: { categoryId, key } },
        update: {},
        create: {
          name,
          key,
          categoryId,
          filterable: shouldBeFilterable(name, value),
        },
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;

      return this.prisma.specification.findUnique({
        where: { categoryId_key: { categoryId, key } },
      });
    }
  }

  private isUniqueViolation(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
