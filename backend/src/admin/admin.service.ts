import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminCreateBrandDto } from './dto/admin-create-brand.dto';
import { AdminCreateCategoryDto } from './dto/admin-create-category.dto';
import { AdminCreateProductDto } from './dto/admin-create-product.dto';
import { AdminUpdateProductDto } from './dto/admin-update-product.dto';
import { AdminProductQueryDto } from './dto/admin-product-query.dto';
import { SitemapsService } from '../parser/sitemaps/sitemaps.service';
import { ThToolsParserService } from '../parser/sites/th-tools.parser';
import { AdminUpdateBrandDto } from './dto/admin-update-brand.dto';
import { AdminUpdateCategoryDto } from './dto/admin-update-category.dto';
import { AdminSitemapQueryDto } from './dto/admin-sitemap-query.dto';
import { ParserLogService } from '../parser/parser-log.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sitemapsService: SitemapsService,
    private readonly thToolsParserService: ThToolsParserService,
    private readonly parserLogService: ParserLogService,
  ) {}

  async getStats() {
    const [products, categories, brands, sources, queuedSitemaps] =
      await Promise.all([
        this.prisma.product.count(),
        this.prisma.category.count(),
        this.prisma.brand.count(),
        this.prisma.source.count(),
        this.prisma.sitemapsThTools.count({ where: { isVisited: false } }),
      ]);

    return { products, categories, brands, sources, queuedSitemaps };
  }

  async getProducts(query: AdminProductQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const skip = (page - 1) * limit;
    const where = {
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
    };
    const sortBy = query.sortBy === 'created' ? 'id' : query.sortBy || 'name';

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { [sortBy]: query.sortOrder || 'asc' },
        skip,
        take: limit,
        include: { brand: true, category: true },
      }),
      this.prisma.product.count({ where }),
    ]);

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

  createProduct(dto: AdminCreateProductDto) {
    return this.prisma.product.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        categoryId: dto.categoryId,
        brandId: dto.brandId,
        priceValue: dto.priceValue,
        priceCurrency: 'BYN',
        stockStatus: dto.stockStatus || 'in_stock',
        descriptionShort: dto.descriptionShort,
        descriptionFull: dto.descriptionFull,
        sku: dto.sku,
        model: dto.model,
        seoTitle: dto.name,
        seoDescription: dto.descriptionShort || dto.name,
      },
    });
  }

  async updateProduct(id: string, dto: AdminUpdateProductDto) {
    await this.ensureProductExists(id);

    return this.prisma.product.update({
      where: { id },
      data: dto,
    });
  }

  async deleteProduct(id: string) {
    await this.ensureProductExists(id);
    await this.prisma.productImage.deleteMany({ where: { productId: id } });
    await this.prisma.productSpecification.deleteMany({
      where: { productId: id },
    });
    await this.prisma.sourceProduct.updateMany({
      where: { productId: id },
      data: { productId: null },
    });
    await this.prisma.product.delete({ where: { id } });
    return { ok: true };
  }

  getSources() {
    return this.prisma.source.findMany({ orderBy: { name: 'asc' } });
  }

  async getQueueStats() {
    const [queued, visited] = await Promise.all([
      this.prisma.sitemapsThTools.count({ where: { isVisited: false } }),
      this.prisma.sitemapsThTools.count({ where: { isVisited: true } }),
    ]);

    return { queued, visited, total: queued + visited };
  }

  async refreshSitemaps() {
    await this.sitemapsService.parseAllSitemapsThTools();
    return this.getQueueStats();
  }

  async processQueuedProducts(limit = 25) {
    await this.thToolsParserService.processSitemapsBatch(limit, 5);
    return this.getQueueStats();
  }

  getBrands() {
    return this.prisma.brand.findMany({ orderBy: { name: 'asc' } });
  }

  createBrand(dto: AdminCreateBrandDto) {
    return this.prisma.brand.create({
      data: {
        ...dto,
        seoTitle: dto.name,
        seoDescription: dto.description || dto.name,
      },
    });
  }

  async updateBrand(id: string, dto: AdminUpdateBrandDto) {
    await this.ensureBrandExists(id);

    return this.prisma.brand.update({
      where: { id },
      data: {
        ...dto,
        seoTitle: dto.name,
        seoDescription: dto.description,
      },
    });
  }

  async deleteBrand(id: string) {
    await this.ensureBrandExists(id);
    await this.prisma.product.updateMany({
      where: { brandId: id },
      data: { brandId: null },
    });
    await this.prisma.brand.delete({ where: { id } });
    return { ok: true };
  }

  getCategories() {
    return this.prisma.category.findMany({
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(dto: AdminCreateCategoryDto) {
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
        seoTitle: dto.name,
        seoDescription: dto.description || dto.name,
      },
    });
  }

  async updateCategory(id: string, dto: AdminUpdateCategoryDto) {
    const current = await this.ensureCategoryExists(id);
    const parent = dto.parentId
      ? await this.prisma.category.findUnique({ where: { id: dto.parentId } })
      : null;
    const slug = dto.slug || current.slug;

    return this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name,
        slug: dto.slug,
        parentId: dto.parentId,
        description: dto.description,
        level: dto.parentId ? (parent?.level ?? 0) + 1 : current.level,
        path: dto.parentId ? [...(parent?.path || []), slug] : current.path,
        seoTitle: dto.name,
        seoDescription: dto.description,
      },
    });
  }

  async deleteCategory(id: string) {
    await this.ensureCategoryExists(id);
    await this.prisma.category.delete({ where: { id } });
    return { ok: true };
  }

  async getSitemaps(query: AdminSitemapQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = {
      ...(query.search
        ? { url: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
      ...(query.isVisited === undefined ? {} : { isVisited: query.isVisited }),
    };
    const [data, total] = await Promise.all([
      this.prisma.sitemapsThTools.findMany({
        where,
        orderBy: { url: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sitemapsThTools.count({ where }),
    ]);

    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  getParserErrors() {
    return this.parserLogService.getErrors();
  }

  clearParserErrors() {
    return this.parserLogService.clearErrors();
  }

  private async ensureProductExists(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
  }

  private async ensureBrandExists(id: string) {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) throw new NotFoundException('Brand not found');
  }

  private async ensureCategoryExists(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }
}
