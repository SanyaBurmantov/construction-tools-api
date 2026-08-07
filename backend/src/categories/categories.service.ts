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
   * branches without published products are pruned. The parser fallback
   * category is unlisted (still reachable by direct URL until curated).
   */
  async getTree(): Promise<CategoryTreeNode[]> {
    const { roots } = await this.buildCountedTree();
    return this.pruneEmpty(
      roots.filter((node) => node.slug !== FALLBACK_CATEGORY_SLUG),
    );
  }

  /** Category landing page payload: breadcrumb ancestors + children with counts. */
  async getBySlug(slug: string): Promise<CategoryPage> {
    const category = await this.prisma.category.findUnique({
      where: { slug },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const { nodes } = await this.buildCountedTree();
    const node = nodes.get(category.id);

    const ancestorSlugs = category.path.filter((item) => item !== slug);
    const ancestorRows = ancestorSlugs.length
      ? await this.prisma.category.findMany({
          where: { slug: { in: ancestorSlugs } },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const ancestors = ancestorSlugs
      .map((item) => ancestorRows.find((row) => row.slug === item))
      .filter((row): row is (typeof ancestorRows)[number] => Boolean(row));

    const children = this.pruneEmpty(node?.children ?? []).map((child) => ({
      id: child.id,
      name: child.name,
      slug: child.slug,
      productCount: child.productCount,
    }));

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

  private pruneEmpty(list: CategoryTreeNode[]): CategoryTreeNode[] {
    return list
      .filter((node) => node.productCount > 0)
      .map((node) => ({ ...node, children: this.pruneEmpty(node.children) }));
  }
}
