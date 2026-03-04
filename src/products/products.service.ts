import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

interface ProductFilters {
  search?: string;
  brand?: string[];
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  facets?: Record<string, any>;
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto) {
    return this.prisma.product.create({
      data: createProductDto,
      include: {
        category: true,
        sourceWebsite: true,
      },
    });
  }

  async findAll(filters?: ProductFilters, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: any = { isActive: true };

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { brand: { contains: filters.search, mode: 'insensitive' } },
        { model: { contains: filters.search, mode: 'insensitive' } },
        { article: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters?.brand && filters.brand.length > 0) {
      where.brand = { in: filters.brand };
    }

    if (filters?.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters?.minPrice !== undefined || filters?.maxPrice !== undefined) {
      where.price = {};
      if (filters.minPrice !== undefined) {
        where.price.gte = filters.minPrice;
      }
      if (filters.maxPrice !== undefined) {
        where.price.lte = filters.maxPrice;
      }
    }

    if (filters?.inStock !== undefined) {
      where.inStock = filters.inStock;
    }

    // Apply facet filters from specifications
    if (filters?.facets) {
      for (const [key, value] of Object.entries(filters.facets)) {
        if (Array.isArray(value) && value.length > 0) {
          where.specifications = {
            path: [key],
            in: value,
          };
        }
      }
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        include: {
          category: true,
          sourceWebsite: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        sourceWebsite: true,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug },
      include: {
        category: true,
        sourceWebsite: true,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with slug ${slug} not found`);
    }

    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    await this.findOne(id); // Check if exists

    return this.prisma.product.update({
      where: { id },
      data: updateProductDto,
      include: {
        category: true,
        sourceWebsite: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if exists

    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async hardDelete(id: string) {
    await this.findOne(id); // Check if exists

    return this.prisma.product.delete({
      where: { id },
    });
  }

  async getFacetOptions(categoryId: string) {
    const facetFilters = await this.prisma.facetFilter.findMany({
      where: { categoryId, isEnabled: true },
      orderBy: { sortOrder: 'asc' },
    });

    const options: Record<string, any> = {};

    for (const filter of facetFilters) {
      const values = await this.prisma.product.findMany({
        where: { categoryId, isActive: true },
        select: {
          [filter.field]: true,
        },
        distinct: [filter.field as any],
      });

      options[filter.field] = {
        ...filter,
        values: values.map((v: any) => v[filter.field]).filter(Boolean),
      };
    }

    return options;
  }

  async upsertBySourceUrl(
    sourceUrl: string,
    createProductDto: CreateProductDto,
  ) {
    const existing = await this.prisma.product.findFirst({
      where: { sourceUrl },
    });

    if (existing) {
      return this.prisma.product.update({
        where: { id: existing.id },
        data: {
          ...createProductDto,
          parsedAt: new Date(),
        },
        include: {
          category: true,
          sourceWebsite: true,
        },
      });
    }

    return this.prisma.product.create({
      data: {
        ...createProductDto,
        sourceUrl,
      },
      include: {
        category: true,
        sourceWebsite: true,
      },
    });
  }
}
