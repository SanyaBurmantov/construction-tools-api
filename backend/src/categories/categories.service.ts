import { CreateCategoryDto } from './dto/create-category.dto';
import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CategoryPage, CategoryTreeNode } from './types/category-tree.type';
import { FALLBACK_CATEGORY_SLUG } from '../common/constants/catalog';

@Injectable()
export class CategoriesService {
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
      image: category.image,
      level: category.level,
      seoTitle: category.seoTitle,
      seoDescription: category.seoDescription,
      productCount: node?.productCount ?? 0,
      ancestors,
      children,
    };
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
