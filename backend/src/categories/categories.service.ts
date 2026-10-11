import { CreateCategoryDto } from './dto/create-category.dto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CategoryPage, CategoryTreeNode } from './types/category-tree.type';
import { FALLBACK_CATEGORY_SLUG } from '../common/constants/catalog';

/** The dearest product with a photo in a category — see `showcaseImages()`. */
type CategoryShowcase = { price: number; url: string };

/** How long a built artwork map is reused. Supplier prices move daily. */
const SHOWCASE_TTL_MS = 15 * 60 * 1000;

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

  async create(dto: CreateCategoryDto) {
    const parent = dto.parentId
      ? await this.prisma.category.findUnique({ where: { id: dto.parentId } })
      : null;

    return this.prisma.category.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        parentId: dto.parentId,
        description: dto.description,
        level: parent ? parent.level + 1 : 0,
        path: parent ? [...parent.path, dto.slug] : [dto.slug],
        // Identity must match what the parsers build, or a hand-made category
        // and a parsed one at the same place in the tree become two rows.
        pathKey: parent ? `${parent.pathKey}/${dto.slug}` : dto.slug,
        seoTitle: dto.name,
        seoDescription: dto.description || dto.name,
      },
    });
  }

  findAll() {
    return this.prisma.category.findMany();
  }

  /**
   * Category tree for storefront navigation. Counts include descendants;
   * branches without published products, and branches an admin switched off,
   * are pruned. The parser fallback category is unlisted (still reachable by
   * direct URL until curated).
   */
  async getTree(): Promise<CategoryTreeNode[]> {
    const { roots } = await this.buildCountedTree();
    return this.pruneUnlistable(
      roots.filter((node) => node.slug !== FALLBACK_CATEGORY_SLUG),
    );
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
      image: node?.image ?? category.image,
      level: category.level,
      seoTitle: category.seoTitle,
      seoDescription: category.seoDescription,
      productCount: node?.productCount ?? 0,
      ancestors,
      children,
    };
  }

  /**
   * Tile artwork a category has not been given by hand: the photo of the most
   * expensive published product in it, its own or any descendant's.
   *
   * Why the most expensive: a category tile is a shop window, and the dearest
   * item is the one that looks like the category rather than like a consumable.
   * Products without a photo are skipped outright, so the picture is never a
   * placeholder — a category where nothing has a photo keeps its letter plate.
   *
   * The shape of the query matters on this box (2 cores, `work_mem` 4 MB).
   * It is deliberately two cheap steps instead of one join of `Product` to the
   * 147k-row image table: pick the winning product per category from a narrow
   * `EXISTS` filter (a hash semi join, and the sort carries three columns, not
   * a URL), then read the first image of those ~1.5k winners by primary-key
   * index. Over a 15-minute cache, since prices move once a day at most.
   */
  private async showcaseImages(): Promise<Map<string, CategoryShowcase>> {
    const fresh = this.showcases;
    if (fresh && Date.now() - fresh.at < SHOWCASE_TTL_MS) return fresh.value;
    // One request fills the cache; the rest of a burst waits for that one.
    this.showcasesInFlight ??= this.loadShowcaseImages().finally(() => {
      this.showcasesInFlight = null;
    });
    return this.showcasesInFlight;
  }

  private async loadShowcaseImages(): Promise<Map<string, CategoryShowcase>> {
    try {
      const winners = await this.prisma.$queryRaw<
        Array<{ categoryId: string; productId: string; price: number }>
      >`
        SELECT DISTINCT ON (p."categoryId")
          p."categoryId" AS "categoryId",
          p."id"         AS "productId",
          p."priceValue" AS "price"
        FROM "Product" p
        WHERE p."status" = 'PUBLISHED'
          AND p."priceValue" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "ProductImage" i WHERE i."productId" = p."id"
          )
        ORDER BY p."categoryId", p."priceValue" DESC, p."id"
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
        if (!firstImage.has(image.productId)) {
          firstImage.set(image.productId, image.url);
        }
      }

      const byCategory = new Map<string, CategoryShowcase>();
      for (const row of winners) {
        const url = firstImage.get(row.productId);
        if (url) byCategory.set(row.categoryId, { price: row.price, url });
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

  private async buildCountedTree(): Promise<{
    nodes: Map<string, CategoryTreeNode>;
    roots: CategoryTreeNode[];
  }> {
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
    // products of its own, so its tile borrows the dearest photo in its
    // subtree. An image an admin set is never overwritten.
    const showcases = await this.showcaseImages();
    const inherit = (node: CategoryTreeNode): CategoryShowcase | null => {
      let best = showcases.get(node.id) ?? null;
      for (const child of node.children) {
        const fromChild = inherit(child);
        if (fromChild && (!best || fromChild.price > best.price)) {
          best = fromChild;
        }
      }
      if (!node.image && best) node.image = best.url;
      return best;
    };
    roots.forEach(inherit);

    // Curated order first, then the catalogue's own gravity.
    //
    // `sortOrder = 0` means "nobody has placed this one" — the default for
    // every category a parser created — so it sorts *after* the curated rows
    // rather than ahead of them, and those rows keep listing biggest-first.
    // Admin reordering renumbers a whole row of siblings from 1, so a category
    // can be pushed down as well as pulled up.
    const rank = (node: CategoryTreeNode) =>
      node.sortOrder > 0 ? node.sortOrder : Number.MAX_SAFE_INTEGER;
    const sortChildren = (list: CategoryTreeNode[]) => {
      list.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          b.productCount - a.productCount ||
          a.name.localeCompare(b.name, 'ru'),
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
  private pruneUnlistable(list: CategoryTreeNode[]): CategoryTreeNode[] {
    return list
      .filter((node) => node.isVisible && node.productCount > 0)
      .map((node) => ({
        ...node,
        children: this.pruneUnlistable(node.children),
      }));
  }
}
