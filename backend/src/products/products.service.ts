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

    const where: Prisma.ProductWhereInput = { status: 'PUBLISHED' };
    if (filter.search) {
      where.name = { contains: filter.search, mode: 'insensitive' };
    }
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.brandId) where.brandId = filter.brandId;
    if (filter.sourceCode) {
      where.sourceProducts = { some: { source: { code: filter.sourceCode } } };
    }
    if (filter.priceMin !== undefined || filter.priceMax !== undefined) {
      where.priceValue = {};
      if (filter.priceMin !== undefined) where.priceValue.gte = filter.priceMin;
      if (filter.priceMax !== undefined) where.priceValue.lte = filter.priceMax;
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput = {};
    if (filter.sortBy) {
      const field = filter.sortBy === 'price' ? 'priceValue' : filter.sortBy;
      orderBy[field] = filter.sortOrder ?? 'asc';
    } else {
      orderBy.name = 'asc';
    }

    const total = await this.prisma.product.count({ where });

    const [products, categoryCounts, brandCounts, sourceCounts] =
      await Promise.all([
        this.prisma.product.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            brand: true,
            category: true,
            images: true,
            sourceProducts: true,
            productSpecs: {
              include: { specification: true },
            },
          },
        }),
        this.prisma.product.groupBy({
          by: ['categoryId'],
          where: { status: 'PUBLISHED' },
          _count: { _all: true },
        }),
        this.prisma.product.groupBy({
          by: ['brandId'],
          where: { status: 'PUBLISHED', brandId: { not: null } },
          _count: { _all: true },
        }),
        this.prisma.sourceProduct.groupBy({
          by: ['sourceId'],
          where: { product: { status: 'PUBLISHED' } },
          _count: { _all: true },
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
}
