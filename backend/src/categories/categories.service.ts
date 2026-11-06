import { CATEGORY_NO_IMAGE } from './category-image';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CategoryPage, CategoryTreeNode } from './types/category-tree.type';
import { FALLBACK_CATEGORY_SLUG } from '../common/constants/catalog';
import { Prisma } from '@prisma/client';
import {
  isPlaceholderImageUrl,
  PLACEHOLDER_IMAGE_MARKERS,
} from '../common/utils/product-images';

/**
 * A real photo, not a supplier's «нет фото» asset (`product-images.ts`): a
 * tile must never show a placeholder, and ~12% of old products carry one.
 */
const REAL_PHOTO_SQL = Prisma.join(
  PLACEHOLDER_IMAGE_MARKERS.map(
    (marker) =>
      Prisma.sql`i."url" NOT ILIKE ${`%${marker.replace(/[\\%_]/g, '\\$&')}%`}`,
  ),
  ' AND ',
);

/** The dearest product with a photo in a category — see `showcaseImages()`. */
type CategoryShowcase = { url: string };

/** How long a built artwork map is reused. Supplier prices move daily. */
const SHOWCASE_TTL_MS = 15 * 60 * 1000;

/** Short: an admin edit shows up within seconds, and ISR caches longer. */
const TREE_CACHE_TTL_MS = 30_000;

type CountedTree = {
  nodes: Map<string, CategoryTreeNode>;
  roots: CategoryTreeNode[];
};

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);
  private showcases: {
    at: number;
    value: Map<string, CategoryShowcase>;
  } | null = null;
  private showcasesInFlight: Promise<Map<string, CategoryShowcase>> | null =
    null;

  constructor(private prisma: PrismaService) {}

  /**
   * Category tree for storefront navigation. Counts include descendants;
   * branches without published products, and branches an admin switched off,
   * are pruned. The parser fallback category is unlisted (still reachable by
   * direct URL until curated).
   *
   * `depth` keeps that many levels (1 = roots only); nodes on the last kept
   * level arrive with `children: []`. Counts and artwork are aggregated
   * before the cut, so a shallow tree reports the same numbers as a full one.
   */
  async getTree(depth?: number): Promise<CategoryTreeNode[]> {
    const { roots } = await this.buildCountedTree();
    return this.pruneUnlistable(
      roots.filter((node) => node.slug !== FALLBACK_CATEGORY_SLUG),
      depth,
    );
  }

  /**
   * The categories of `ids` that a storefront listing may show right now —
   * visible, with published products, under no switched-off ancestor and not
   * the parsers' fallback — with their counts. A curated list (the header
   * strip) runs through this, so an admin's pick can never put a link to an
   * empty grid on every page.
   */
  async listableByIds(ids: string[]): Promise<Map<string, CategoryTreeNode>> {
    const { nodes } = await this.buildCountedTree();
    const out = new Map<string, CategoryTreeNode>();
    for (const id of ids) {
      const node = nodes.get(id);
      if (!node || node.productCount <= 0) continue;
      let listable = true;
      for (
        let at: CategoryTreeNode | undefined = node;
        at;
        at = at.parentId ? nodes.get(at.parentId) : undefined
      ) {
        if (!at.isVisible || at.slug === FALLBACK_CATEGORY_SLUG) {
          listable = false;
          break;
        }
      }
      if (listable) out.set(id, { ...node, children: [] });
    }
    return out;
  }

  /** Category landing page payload: breadcrumb ancestors + children with counts. */
  async getBySlug(slug: string): Promise<CategoryPage> {
    const direct = await this.prisma.category.findUnique({
      where: { slug },
    });
    const alias = direct
      ? null
      : await this.prisma.categoryRedirect.findUnique({
          where: { slug },
          include: { category: true },
        });
    const category = direct ?? alias?.category;
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const { nodes } = await this.buildCountedTree();
    const node = nodes.get(category.id);

    // Identity paths contain supplier name slugs, which may differ from the
    // public slugs after collisions/merges. Follow parent IDs for navigation.
    const ancestors: Array<{ id: string; name: string; slug: string }> = [];
    const seen = new Set<string>([category.id]);
    let parentId = category.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = nodes.get(parentId);
      if (!parent) break;
      ancestors.unshift({
        id: parent.id,
        name: parent.name,
        slug: parent.slug,
      });
      parentId = parent.parentId;
    }

    const children = this.pruneUnlistable(node?.children ?? []).map(
      (child) => ({
        id: child.id,
        name: child.name,
        slug: child.slug,
        image: child.image,
        productCount: child.productCount,
      }),
    );

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      // The node carries the inherited artwork; the row only has what an admin
      // typed in.
      image: node
        ? node.image
        : category.image === CATEGORY_NO_IMAGE
          ? null
          : category.image,
      level: category.level,
      seoTitle: category.seoTitle,
      seoDescription: category.seoDescription,
      isVisible: category.isVisible,
      productCount: node?.productCount ?? 0,
      ancestors,
      children,
    };
  }

  /**
   * Tile artwork a category has not been given by hand: the photo of its
   * **typical** product — the first one with a real photo in the category's
   * default order (`listingRank` — complete cards first —, then the name),
   * i.e. what a visitor sees first on opening it (owner, 2026-11-05). It used
   * to be the most expensive product, which is usually the odd one out: a
   * workshop station with another shop's watermark for «Наборы
   * инструментов», a display stand for «Сантехника». Products without a
   * photo, or with a supplier's «нет фото» asset, are skipped, so the picture
   * is never a placeholder — a category with no photo keeps its letter plate.
   *
   * The shape of the query matters on this box (2 cores, `work_mem` 4 MB).
   * It is deliberately two cheap steps instead of one join of `Product` to the
   * 147k-row image table: pick the winning product per category from a narrow
   * `EXISTS` filter (a hash semi join, and the sort carries three columns, not
   * a URL), then read the first image of those ~1.5k winners by primary-key
   * index. Over a 15-minute cache, refreshed in the background.
   */
  private async showcaseImages(): Promise<Map<string, CategoryShowcase>> {
    const cached = this.showcases;
    if (cached && Date.now() - cached.at < SHOWCASE_TTL_MS) return cached.value;
    // One request fills the cache; the rest of a burst waits for that one.
    this.showcasesInFlight ??= this.loadShowcaseImages().finally(() => {
      this.showcasesInFlight = null;
    });
    // Stale artwork is served while the next map is built (~1.3 s on prod):
    // only the very first request after a start waits for the query.
    if (cached) {
      void this.showcasesInFlight;
      return cached.value;
    }
    return this.showcasesInFlight;
  }

  private async loadShowcaseImages(): Promise<Map<string, CategoryShowcase>> {
    try {
      const winners = await this.prisma.$queryRaw<
        Array<{ categoryId: string; productId: string }>
      >`
        SELECT DISTINCT ON (p."categoryId")
          p."categoryId" AS "categoryId",
          p."id"         AS "productId"
        FROM "Product" p
        WHERE p."status" = 'PUBLISHED'
          AND p."priceValue" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "ProductImage" i
            WHERE i."productId" = p."id" AND ${REAL_PHOTO_SQL}
          )
        ORDER BY p."categoryId", p."listingRank" DESC, p."name", p."id"
      `;

      const images = winners.length
        ? await this.prisma.productImage.findMany({
            where: { productId: { in: winners.map((row) => row.productId) } },
            orderBy: [{ productId: 'asc' }, { order: 'asc' }],
            select: { productId: true, url: true },
          })
        : [];

      const firstImage = new Map<string, string>();
      for (const image of images) {
        if (isPlaceholderImageUrl(image.url)) continue;
        if (!firstImage.has(image.productId)) {
          firstImage.set(image.productId, image.url);
        }
      }

      const byCategory = new Map<string, CategoryShowcase>();
      for (const row of winners) {
        const url = firstImage.get(row.productId);
        if (url) byCategory.set(row.categoryId, { url });
      }

      this.showcases = { at: Date.now(), value: byCategory };
      return byCategory;
    } catch (error) {
      // Artwork is decoration; navigation is not. A failure here leaves every
      // tile on its letter plate instead of taking the menu down with it.
      this.logger.warn(`Could not build category artwork: ${String(error)}`);
      return new Map();
    }
  }

  private treeCache: {
    promise: Promise<CountedTree>;
    expiresAt: number;
  } | null = null;

  /**
   * The counted tree, shared for a few seconds. Building it reads every
   * category and groups every published product, and it ran on each
   * `/categories/tree` and `/categories/:slug` — the client-side menu fetch
   * and category pages outside Nitro's cache included. Callers only read it
   * (`pruneUnlistable` copies), so sharing is safe; the promise is cached, so
   * concurrent requests wait for one build instead of starting their own.
   */
  private buildCountedTree(): Promise<CountedTree> {
    const now = Date.now();
    if (this.treeCache && this.treeCache.expiresAt > now) {
      return this.treeCache.promise;
    }
    const promise = this.buildCountedTreeUncached();
    this.treeCache = { promise, expiresAt: now + TREE_CACHE_TTL_MS };
    // A failed build must not be served for the whole TTL.
    promise.catch(() => {
      if (this.treeCache?.promise === promise) this.treeCache = null;
    });
    return promise;
  }

  private async buildCountedTreeUncached(): Promise<CountedTree> {
    const [categories, counts] = await Promise.all([
      this.prisma.category.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          level: true,
          image: true,
          sortOrder: true,
          isVisible: true,
          isFeatured: true,
        },
      }),
      this.prisma.product.groupBy({
        by: ['categoryId'],
        where: { status: 'PUBLISHED' },
        _count: { _all: true },
      }),
    ]);

    const ownCounts = new Map(
      counts.map((item) => [item.categoryId, item._count._all]),
    );
    const nodes = new Map<string, CategoryTreeNode>(
      categories.map((category) => [
        category.id,
        {
          ...category,
          productCount: ownCounts.get(category.id) ?? 0,
          children: [],
        },
      ]),
    );

    const roots: CategoryTreeNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const aggregate = (node: CategoryTreeNode): number => {
      node.productCount += node.children.reduce(
        (sum, child) => sum + aggregate(child),
        0,
      );
      return node.productCount;
    };
    roots.forEach(aggregate);

    // Artwork rolls up the same way counts do: a root category holds no
    // products of its own, so its tile borrows the picture of its biggest
    // part — its own products or the child with the most products, whichever
    // is larger — so «Наборы инструментов» looks like what most of it is. An
    // image an admin set is shown, but the rolled-up one still travels up.
    const showcases = await this.showcaseImages();
    const inherit = (node: CategoryTreeNode): CategoryShowcase | null => {
      const childTotal = node.children.reduce(
        (sum, c) => sum + c.productCount,
        0,
      );
      let best = showcases.get(node.id) ?? null;
      let weight = best ? node.productCount - childTotal : -1;
      for (const child of node.children) {
        const fromChild = inherit(child);
        if (fromChild && child.productCount > weight) {
          best = fromChild;
          weight = child.productCount;
        }
      }
      // «Без картинки» chosen by an admin: the tile keeps its letter plate,
      // while the rolled-up photo still travels up to the parent.
      if (node.image === CATEGORY_NO_IMAGE) node.image = null;
      else if (!node.image && best) node.image = best.url;
      return best;
    };
    roots.forEach(inherit);

    // Biggest first, everywhere (owner, 2026-11-05: «сортировать просто по
    // количеству товаров»). `sortOrder` no longer orders anything: one press
    // of the old ↑/↓ buttons renumbered all 42 roots almost alphabetically
    // and put «Косметика, уход» and the hidden fallback at the top.
    const sortChildren = (list: CategoryTreeNode[]) => {
      list.sort(
        (a, b) =>
          b.productCount - a.productCount || a.name.localeCompare(b.name, 'ru'),
      );
      list.forEach((node) => sortChildren(node.children));
    };
    sortChildren(roots);

    return { nodes, roots };
  }

  /**
   * Drops what a storefront listing must never show: branches an admin hid,
   * and branches with nothing published in them.
   *
   * The empty check is the reason the menu and the category page can be
   * rendered from one payload — a supplier category whose products were all
   * delisted or hidden keeps its row in `Category`, and listing it produced a
   * link to an empty grid. Hidden branches are pruned whole: a visible child
   * under a switched-off parent is unreachable through navigation anyway.
   */
  private pruneUnlistable(
    list: CategoryTreeNode[],
    depth = Number.POSITIVE_INFINITY,
  ): CategoryTreeNode[] {
    return list
      .filter((node) => node.isVisible && node.productCount > 0)
      .map((node) => ({
        ...node,
        children:
          depth > 1 ? this.pruneUnlistable(node.children, depth - 1) : [],
      }));
  }
}
