import { CreateProductDto } from './dto/create-product-dto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductFilter } from './types/product-filter.type';
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
        seoTitle: dto.name,
        seoDescription: dto.name,
      },
    });
  }

  async getProductBySlug(slug: string) {
    return this.prisma.product.findUnique({
      where: { slug },
      include: {
        brand: true,
        category: true,
        images: true,
        sourceProducts: true,
        productSpecs: {
          include: { specification: true },
        },
      },
    })
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
    const limit = filter.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.search) {
      where.name = { contains: filter.search, mode: 'insensitive' };
    }
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.brandId) where.brandId = filter.brandId;
    if (filter.priceMin !== undefined || filter.priceMax !== undefined) {
      where.priceValue = {};
      if (filter.priceMin !== undefined) where.priceValue.gte = filter.priceMin;
      if (filter.priceMax !== undefined) where.priceValue.lte = filter.priceMax;
    }

    const orderBy: any = {};
    if (filter.sortBy) {
      const field = filter.sortBy === 'price' ? 'priceValue' : 'name';
      orderBy[field] = filter.sortOrder ?? 'asc';
    } else {
      orderBy.name = 'asc';
    }

    const total = await this.prisma.product.count({ where });

    const products = await this.prisma.product.findMany({
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
    });

    const data = products.map(p => ({
      ...p,
      productSpecs: p.productSpecs.map(ps => ({
        name: ps.specification.name,
        value: ps.value,
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
    };
  }
}
