import { CreateProductDto } from './dto/create-product-dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductFilterDto } from './dto/product-filter-dto';

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        slug: dto.slug,
        name: dto.name,
        categoryId: dto.categoryId,
        brandId: dto.brandId,
        priceValue: 0,
        priceCurrency: 'BYN',
        stockStatus: 'out_of_stock',
        status: 'DRAFT',
        seoTitle: dto.name,
        seoDescription: dto.name,
      },
    });
  }

  async getProductBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'PUBLISHED' },
      include: {
        brand: true,
        category: true,
        images: true,
        sourceProducts: true,
        productSpecs: {
          include: { specification: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      ...product,
      productSpecs: product.productSpecs.map((productSpec) => ({
        name: productSpec.specification.name,
        value: productSpec.value,
      })),
    };
  }

  /** Slim list of published products for sitemap generation. */
  getSitemapEntries() {
    return this.prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findAll() {
    return this.prisma.product.findMany({
      include: {
        brand: true,
        category: true,
        productSpecs: {
          include: {
            specification: true,
          },
        },
        images: true,
        sourceProducts: true,
      },
    });
  }

  async findAllFiltered(filter: ProductFilterDto) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const categoryIds = await this.resolveCategoryIds(filter);
    const brandIds = filter.brandId
      ? filter.brandId
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : undefined;

    // Where is rebuilt per facet with that facet's own dimension excluded,
    // so counts answer "what would I get if I picked this value instead".
    const buildWhere = (
      omit?: 'category' | 'brand' | 'source' | 'price',
    ): Prisma.ProductWhereInput => {
      const where: Prisma.ProductWhereInput = { status: 'PUBLISHED' };
      if (filter.search) {
        const term = filter.search.trim();
        where.OR = [
          { name: { contains: term, mode: 'insensitive' } },
          { sku: { contains: term, mode: 'insensitive' } },
          { model: { contains: term, mode: 'insensitive' } },
          { brand: { name: { contains: term, mode: 'insensitive' } } },
        ];
      }
      if (filter.inStock) where.stockStatus = 'in_stock';
      if (omit !== 'category' && categoryIds) {
        where.categoryId = { in: categoryIds };
      }
      if (omit !== 'brand' && brandIds?.length) {
        where.brandId = { in: brandIds };
      }
      if (omit !== 'source' && filter.sourceCode) {
        where.sourceProducts = {
          some: { source: { code: filter.sourceCode } },
        };
      }
      if (
        omit !== 'price' &&
        (filter.priceMin !== undefined || filter.priceMax !== undefined)
      ) {
        where.priceValue = {};
        if (filter.priceMin !== undefined)
          where.priceValue.gte = filter.priceMin;
        if (filter.priceMax !== undefined)
          where.priceValue.lte = filter.priceMax;
      }
      return where;
    };
    const where = buildWhere();

    const orderBy: Prisma.ProductOrderByWithRelationInput = {};
    if (filter.sortBy) {
      const field = filter.sortBy === 'price' ? 'priceValue' : filter.sortBy;
      orderBy[field] = filter.sortOrder ?? 'asc';
    } else {
      orderBy.name = 'asc';
    }

    const [total, products, categoryCounts, brandCounts, sourceCounts, price] =
      await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            brand: true,
            category: true,
            images: { orderBy: { order: 'asc' } },
            productSpecs: {
              include: { specification: true },
            },
          },
        }),
        this.prisma.product.groupBy({
          by: ['categoryId'],
          where: buildWhere('category'),
          _count: { _all: true },
        }),
        this.prisma.product.groupBy({
          by: ['brandId'],
          where: { ...buildWhere('brand'), brandId: { not: null } },
          _count: { _all: true },
        }),
        this.prisma.sourceProduct.groupBy({
          by: ['sourceId'],
          where: { product: buildWhere('source') },
          _count: { _all: true },
        }),
        this.prisma.product.aggregate({
          where: { ...buildWhere('price'), priceValue: { gt: 0 } },
          _min: { priceValue: true },
          _max: { priceValue: true },
        }),
      ]);

    const facets = {
      categories: Object.fromEntries(
        categoryCounts.map((item) => [item.categoryId, item._count._all]),
      ),
      brands: Object.fromEntries(
        brandCounts
          .filter((item) => item.brandId)
          .map((item) => [item.brandId as string, item._count._all]),
      ),
      sources: Object.fromEntries(
        sourceCounts.map((item) => [item.sourceId, item._count._all]),
      ),
      priceRange:
        price._min.priceValue !== null
          ? {
              min: Math.floor(price._min.priceValue),
              max: Math.ceil(price._max.priceValue ?? price._min.priceValue),
            }
          : null,
    };

    const data = products.map((product) => ({
      ...product,
      productSpecs: product.productSpecs.map((productSpec) => ({
        name: productSpec.specification.name,
        value: productSpec.value,
      })),
    }));

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      facets,
    };
  }

  /**
   * Category filter covers the whole subtree: products live on leaf
   * categories, so picking a parent must include its descendants.
   * Returns undefined when no category filter is set, [] for unknown ones.
   */
  private async resolveCategoryIds(
    filter: ProductFilterDto,
  ): Promise<string[] | undefined> {
    if (!filter.categoryId && !filter.categorySlug) return undefined;

    const categories = await this.prisma.category.findMany({
      select: { id: true, parentId: true, slug: true },
    });
    const target = categories.find(
      (category) =>
        (filter.categoryId && category.id === filter.categoryId) ||
        (filter.categorySlug && category.slug === filter.categorySlug),
    );
    if (!target) return [];

    const childrenByParent = new Map<string, string[]>();
    for (const category of categories) {
      if (!category.parentId) continue;
      const list = childrenByParent.get(category.parentId) ?? [];
      list.push(category.id);
      childrenByParent.set(category.parentId, list);
    }

    const ids: string[] = [];
    const queue = [target.id];
    while (queue.length) {
      const id = queue.shift() as string;
      ids.push(id);
      queue.push(...(childrenByParent.get(id) ?? []));
    }
    return ids;
  }
}
