import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  NON_CORE_ROOT_NAMES,
  nonCoreCategoryIds,
  rootsOf,
} from '../products/core-catalog';
import {
  composePopularRow,
  SIGNAL_WEIGHTS,
  type PopularSignal,
} from './auto-popular';
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
  /**
   * What the home page's «Каталог» tiles draw — they follow the strip's
   * order. The category's own artwork, else its subtree's fallback photo.
   */
  image: string | null;
  productCount: number;
};

/** The header strip is fetched by every SSR render — read it once a while. */
const CACHE_TTL_MS = 30_000;
/** The automatic popular row: recomputed hourly, in the background. */
const AUTO_POPULAR_TTL_MS = 60 * 60_000;
const AUTO_POPULAR_SIZE = 10;

/** See storefront-config.ts for what is curated and why. */
@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);
  private autoPopular: { at: number; ids: string[] } | null = null;
  private autoPopularInFlight: Promise<string[]> | null = null;
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
              image: node.image,
              productCount: node.productCount,
            },
          ]
        : [];
    });
  }

  /**
   * «Популярное у организаций»: the curated products still on sale, in order;
   * with nothing curated, the automatic row (`auto-popular.ts`).
   */
  async popularProducts() {
    const { popularProducts } = await this.getConfig();
    const curated = await this.products.cardsByIds(popularProducts);
    if (curated.length) return curated;
    return this.products.cardsByIds(await this.autoPopularIds());
  }

  /** Cached an hour; a stale row is served while the next one is built. */
  async autoPopularIds(): Promise<string[]> {
    const cached = this.autoPopular;
    if (cached && Date.now() - cached.at < AUTO_POPULAR_TTL_MS)
      return cached.ids;
    this.autoPopularInFlight ??= this.buildAutoPopular()
      .then((ids) => {
        this.autoPopular = { at: Date.now(), ids };
        return ids;
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Popular row: ${error instanceof Error ? error.message : String(error)}`,
        );
        return cached?.ids ?? [];
      })
      .finally(() => {
        this.autoPopularInFlight = null;
      });
    return cached ? cached.ids : this.autoPopularInFlight;
  }

  private async buildAutoPopular(): Promise<string[]> {
    const [rows, tree] = await Promise.all([
      this.prisma.category.findMany({
        select: { id: true, parentId: true, name: true },
      }),
      this.categories.getTree(1),
    ]);
    const roots = rootsOf(rows);
    const nonCore = nonCoreCategoryIds(rows);
    const excludedRoots = new Set(NON_CORE_ROOT_NAMES);
    // Listed departments only (visible, non-empty), biggest first.
    const rootOrder = tree
      .filter((root) => !excludedRoots.has(root.name))
      .map((root) => root.id);
    const listed = new Set(rootOrder);

    // A showcase product: on sale, priced, in stock, with a real photo.
    const showcase = Prisma.sql`p."status" = 'PUBLISHED' AND p."priceValue" > 0
      AND p."stockStatus" = 'in_stock' AND p."listingRank" >= 2
      AND NOT (p."categoryId" = ANY(${nonCore}::text[]))`;

    const scored = await this.prisma.$queryRaw<
      Array<{ id: string; categoryId: string; score: number }>
    >`
      SELECT p.id, p."categoryId",
        (COALESCE(o.n, 0) * ${SIGNAL_WEIGHTS.order}
          + COALESCE(c.n, 0) * ${SIGNAL_WEIGHTS.cart}
          + COALESCE(s.n, 0) * ${SIGNAL_WEIGHTS.searchClick}
          + COALESCE(v.n, 0) * ${SIGNAL_WEIGHTS.visitor})::float AS score
      FROM "Product" p
      LEFT JOIN (
        SELECT oi."productId" AS id, count(DISTINCT oi."orderId") AS n
        FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
        WHERE o.status <> 'CANCELLED' AND o."createdAt" > now() - interval '90 days'
        GROUP BY 1
      ) o ON o.id = p.id
      LEFT JOIN (
        SELECT "productId" AS id, count(*) AS n FROM "CartItem"
        WHERE "updatedAt" > now() - interval '60 days' GROUP BY 1
      ) c ON c.id = p.id
      LEFT JOIN (
        SELECT "productId" AS id, count(DISTINCT COALESCE("ipHash", id)) AS n
        FROM "SearchEvent"
        WHERE kind = 'CLICK' AND "productId" IS NOT NULL
          AND "createdAt" > now() - interval '30 days'
        GROUP BY 1
      ) s ON s.id = p.id
      LEFT JOIN (
        SELECT substring(path FROM 10) AS slug, count(DISTINCT "visitorId") AS n
        FROM "PageView"
        WHERE path LIKE '/product/%' AND status = 200
          AND "createdAt" > now() - interval '30 days'
        GROUP BY 1
      ) v ON v.slug = p.slug
      WHERE ${showcase}
        AND (o.n IS NOT NULL OR c.n IS NOT NULL OR s.n IS NOT NULL OR v.n IS NOT NULL)
      ORDER BY score DESC
      LIMIT 60`;
    const signals: PopularSignal[] = scored
      .map((row) => ({
        productId: row.id,
        rootId: roots.get(row.categoryId)?.id ?? '',
        score: Number(row.score),
      }))
      .filter((signal) => listed.has(signal.rootId));

    // The fill: per department, its best cards in an order that changes
    // daily, so the row does not stand still while signals are few.
    const day = new Date().toISOString().slice(0, 10);
    const fill = new Map<string, string[]>();
    for (const rootId of rootOrder.slice(0, AUTO_POPULAR_SIZE)) {
      const subtree = rows
        .filter((row) => roots.get(row.id)?.id === rootId)
        .map((row) => row.id);
      const picks = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT p.id FROM "Product" p
        WHERE ${showcase} AND p."categoryId" = ANY(${subtree}::text[])
        ORDER BY p."listingRank" DESC, md5(p.id || ${day})
        LIMIT 3`;
      fill.set(
        rootId,
        picks.map((pick) => pick.id),
      );
    }
    return composePopularRow(signals, fill, rootOrder, AUTO_POPULAR_SIZE);
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
