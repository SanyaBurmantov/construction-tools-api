import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import { ProductService } from '../products/products.service';
import {
  KEY_HEADER_CATEGORIES,
  KEY_POPULAR_PRODUCTS,
  normalizeHeaderCategories,
  normalizeProductIds,
  parseStoredConfig,
  type StorefrontConfig,
} from './storefront-config';

export type HeaderCategoryLink = {
  id: string;
  name: string;
  slug: string;
  highlight: boolean;
};

/** The header strip is fetched by every SSR render — read it once a while. */
const CACHE_TTL_MS = 30_000;

/** See storefront-config.ts for what is curated and why. */
@Injectable()
export class StorefrontService {
  private headerCache: {
    at: number;
    value: Promise<HeaderCategoryLink[]>;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly products: ProductService,
  ) {}

  async getConfig(): Promise<StorefrontConfig> {
    const rows = await this.prisma.siteSetting.findMany({
      where: { key: { in: [KEY_HEADER_CATEGORIES, KEY_POPULAR_PRODUCTS] } },
    });
    return parseStoredConfig(new Map(rows.map((r) => [r.key, r.value])));
  }

  /**
   * The strip under the header, curated order, only categories a listing may
   * show right now (an emptied or hidden one drops out on its own). Empty =
   * not curated: the storefront keeps its automatic strip.
   */
  headerCategories(): Promise<HeaderCategoryLink[]> {
    const now = Date.now();
    if (this.headerCache && now - this.headerCache.at < CACHE_TTL_MS) {
      return this.headerCache.value;
    }
    const value = this.loadHeaderCategories();
    this.headerCache = { at: now, value };
    value.catch(() => {
      if (this.headerCache?.value === value) this.headerCache = null;
    });
    return value;
  }

  private async loadHeaderCategories(): Promise<HeaderCategoryLink[]> {
    const { headerCategories } = await this.getConfig();
    if (!headerCategories.length) return [];
    const listable = await this.categories.listableByIds(
      headerCategories.map((pick) => pick.categoryId),
    );
    return headerCategories.flatMap((pick) => {
      const node = listable.get(pick.categoryId);
      return node
        ? [
            {
              id: node.id,
              name: pick.label ?? node.name,
              slug: node.slug,
              highlight: pick.highlight,
            },
          ]
        : [];
    });
  }

  /** «Выбирают покупатели»: the curated products still on sale, in order. */
  async popularProducts() {
    const { popularProducts } = await this.getConfig();
    return this.products.cardsByIds(popularProducts);
  }

  /** Everything the admin screen draws, including picks that dropped out. */
  async adminView() {
    const config = await this.getConfig();
    const categoryIds = config.headerCategories.map((p) => p.categoryId);
    const [categories, listable, products] = await Promise.all([
      this.prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true, slug: true, parentId: true },
      }),
      this.categories.listableByIds(categoryIds),
      this.prisma.product.findMany({
        where: { id: { in: config.popularProducts } },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          priceValue: true,
          images: { orderBy: { order: 'asc' }, take: 1, select: { url: true } },
        },
      }),
    ]);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const productById = new Map(products.map((p) => [p.id, p]));
    return {
      headerCategories: config.headerCategories.map((pick) => {
        const category = categoryById.get(pick.categoryId);
        return {
          ...pick,
          name: category?.name ?? null,
          slug: category?.slug ?? null,
          productCount: listable.get(pick.categoryId)?.productCount ?? 0,
          /** False: not shown now (deleted, hidden, or nothing on sale). */
          shown: listable.has(pick.categoryId),
        };
      }),
      popularProducts: config.popularProducts.map((id) => {
        const product = productById.get(id);
        return {
          id,
          name: product?.name ?? null,
          slug: product?.slug ?? null,
          status: product?.status ?? null,
          priceValue: product?.priceValue ?? null,
          image: product?.images[0]?.url ?? null,
          shown: product?.status === 'PUBLISHED' && product.priceValue !== null,
        };
      }),
    };
  }

  /** Replaces both lists; ids that do not exist are a 400, not a silent drop. */
  async update(body: {
    headerCategories?: unknown;
    popularProducts?: unknown;
  }) {
    const writes: Array<{ key: string; value: string }> = [];
    if (body.headerCategories !== undefined) {
      const picks = normalizeHeaderCategories(body.headerCategories);
      const found = await this.prisma.category.count({
        where: { id: { in: picks.map((p) => p.categoryId) } },
      });
      if (found !== picks.length) {
        throw new BadRequestException(
          'Какой-то категории уже нет — обновите страницу',
        );
      }
      writes.push({ key: KEY_HEADER_CATEGORIES, value: JSON.stringify(picks) });
    }
    if (body.popularProducts !== undefined) {
      const ids = normalizeProductIds(body.popularProducts);
      const found = await this.prisma.product.count({
        where: { id: { in: ids } },
      });
      if (found !== ids.length) {
        throw new BadRequestException(
          'Какого-то товара уже нет — обновите страницу',
        );
      }
      writes.push({ key: KEY_POPULAR_PRODUCTS, value: JSON.stringify(ids) });
    }
    await this.prisma.$transaction(
      writes.map(({ key, value }) =>
        this.prisma.siteSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
    this.headerCache = null;
    return this.adminView();
  }
}
