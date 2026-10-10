import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  countProducts,
  sampleProducts,
  staleOffers,
  NO_IMAGES,
  NO_SPECS,
  PUBLISHED,
} from './product-gaps';
import { normalizeName } from '../common/utils/normalize-name';
import { FALLBACK_CATEGORY_SLUG } from '../common/constants/catalog';

const SAMPLE_LIMIT = 20;
const STALE_DAYS = 7;

type ProductRef = { id: string; name: string; slug: string };

export type DuplicateGroup = {
  key: string;
  products: Array<ProductRef & { sources: string[] }>;
};

@Injectable()
export class DataQualityService {
  constructor(private prisma: PrismaService) {}

  /**
   * One-stop catalog health report for the admin UI: how many published
   * products are missing data the storefront depends on, what fell into the
   * parser fallback category, what stopped syncing, and which products look
   * like cross-supplier duplicates.
   */
  async getReport() {
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
    const published = { status: 'PUBLISHED' as const };

    const sample = { select: { id: true, name: true, slug: true } };
    const noPrice = {
      ...published,
      OR: [{ priceValue: null }, { priceValue: { lte: 0 } }],
    };
    const noBrand = { ...published, brandId: null };
    // "Published products with no images / no specifications / no recent
    // supplier sync" are asked as SQL anti-joins — see ./product-gaps for why
    // Prisma's `{ none: {} }` cannot be used here.
    const stale = staleOffers(staleCutoff);

    const fallbackCategory = await this.prisma.category.findUnique({
      where: { slug: FALLBACK_CATEGORY_SLUG },
      select: { id: true },
    });
    const inFallback = fallbackCategory
      ? { ...published, categoryId: fallbackCategory.id }
      : { ...published, id: 'none' };

    const [
      publishedProducts,
      totalProducts,
      withoutImages,
      withoutPrice,
      withoutSpecs,
      withoutBrand,
      inFallbackCategory,
      staleProducts,
      samples,
      allForNameChecks,
    ] = await Promise.all([
      this.prisma.product.count({ where: published }),
      this.prisma.product.count(),
      countProducts(this.prisma, PUBLISHED, NO_IMAGES),
      this.prisma.product.count({ where: noPrice }),
      countProducts(this.prisma, PUBLISHED, NO_SPECS),
      this.prisma.product.count({ where: noBrand }),
      this.prisma.product.count({ where: inFallback }),
      countProducts(this.prisma, PUBLISHED, stale),
      Promise.all([
        sampleProducts(this.prisma, SAMPLE_LIMIT, PUBLISHED, NO_IMAGES),
        this.prisma.product.findMany({
          where: noPrice,
          ...sample,
          take: SAMPLE_LIMIT,
        }),
        sampleProducts(this.prisma, SAMPLE_LIMIT, PUBLISHED, NO_SPECS),
        this.prisma.product.findMany({
          where: inFallback,
          ...sample,
          take: SAMPLE_LIMIT,
        }),
        sampleProducts(this.prisma, SAMPLE_LIMIT, PUBLISHED, stale),
      ]),
      this.prisma.product.findMany({
        where: published,
        select: {
          id: true,
          name: true,
          slug: true,
          brandId: true,
          sourceProducts: { select: { source: { select: { name: true } } } },
        },
      }),
    ]);

    const duplicates = this.findDuplicateGroups(allForNameChecks);
    const allCaps = allForNameChecks.filter((product) =>
      this.isShoutyName(product.name),
    );

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        publishedProducts,
        totalProducts,
        withoutImages,
        withoutPrice,
        withoutSpecs,
        withoutBrand,
        inFallbackCategory,
        staleProducts,
        staleDays: STALE_DAYS,
        duplicateGroups: duplicates.length,
        allCapsNames: allCaps.length,
      },
      samples: {
        withoutImages: samples[0],
        withoutPrice: samples[1],
        withoutSpecs: samples[2],
        inFallbackCategory: samples[3],
        stale: samples[4],
        allCapsNames: allCaps
          .slice(0, SAMPLE_LIMIT)
          .map(({ id, name, slug }) => ({ id, name, slug })),
        duplicates: duplicates.slice(0, SAMPLE_LIMIT),
      },
    };
  }

  /**
   * Same normalized name + same brand from different Product rows usually
   * means the same supplier item imported twice (e.g. by two sources).
   */
  private findDuplicateGroups(
    products: Array<{
      id: string;
      name: string;
      slug: string;
      brandId: string | null;
      sourceProducts: Array<{ source: { name: string } }>;
    }>,
  ): DuplicateGroup[] {
    const groups = new Map<string, DuplicateGroup['products']>();
    for (const product of products) {
      const normalized = normalizeName(product.name);
      if (!normalized) continue;
      const key = `${product.brandId ?? '-'}::${normalized}`;
      const list = groups.get(key) ?? [];
      list.push({
        id: product.id,
        name: product.name,
        slug: product.slug,
        sources: [
          ...new Set(product.sourceProducts.map((item) => item.source.name)),
        ],
      });
      groups.set(key, list);
    }

    return [...groups.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({ key: key.split('::')[1], products: list }))
      .sort((a, b) => b.products.length - a.products.length);
  }

  /** Supplier names that are all caps read badly on the storefront. */
  private isShoutyName(name: string) {
    const letters = name.replace(/[^a-zа-яё]/gi, '');
    if (letters.length < 8) return false;
    return letters === letters.toUpperCase();
  }
}
