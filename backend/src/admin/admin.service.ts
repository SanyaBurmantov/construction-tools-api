import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminCreateBrandDto } from './dto/admin-create-brand.dto';
import { AdminCreateCategoryDto } from './dto/admin-create-category.dto';
import { AdminCreateProductDto } from './dto/admin-create-product.dto';
import { AdminUpdateProductDto } from './dto/admin-update-product.dto';
import { AdminProductQueryDto } from './dto/admin-product-query.dto';
import { SitemapsService } from '../parser/sitemaps/sitemaps.service';
import { ThToolsParserService } from '../parser/sites/th-tools.parser';
import { DukonParserService } from '../parser/sites/dukon.parser';
import { Supplier7745ParserService } from '../parser/sites/7745-source.parser';
import { ToolsByParserService } from '../parser/sites/tools-by-source.parser';
import { AdminUpdateBrandDto } from './dto/admin-update-brand.dto';
import { AdminUpdateCategoryDto } from './dto/admin-update-category.dto';
import { AdminSitemapQueryDto } from './dto/admin-sitemap-query.dto';
import { ParserLogService } from '../parser/parser-log.service';
import { ParserRuntimeStatusService } from '../parser/parser-runtime-status.service';
import { AdminImportSourceProductDto } from './dto/admin-import-source-product.dto';
import { AdminDukonSitemapQueryDto } from './dto/admin-dukon-sitemap-query.dto';
import { Admin7745SitemapQueryDto } from './dto/admin-7745-sitemap-query.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sitemapsService: SitemapsService,
    private readonly thToolsParserService: ThToolsParserService,
    private readonly dukonParserService: DukonParserService,
    private readonly supplier7745ParserService: Supplier7745ParserService,
    private readonly toolsByParserService: ToolsByParserService,
    private readonly parserLogService: ParserLogService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
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
      ...(query.status ? { status: query.status } : {}),
    };
    const sortBy =
      query.sortBy === 'created'
        ? 'createdAt'
        : query.sortBy === 'updated'
          ? 'updatedAt'
          : query.sortBy || 'name';

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { [sortBy]: query.sortOrder || 'asc' },
        skip,
        take: limit,
        include: {
          brand: true,
          category: true,
          sourceProducts: { include: { source: true } },
        },
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
        name: dto.name.trim(),
        slug: dto.slug.trim(),
        categoryId: dto.categoryId,
        brandId: dto.brandId || null,
        priceValue: dto.priceValue,
        stockStatus: dto.stockStatus || 'in_stock',
        status: dto.status || 'PUBLISHED',
        descriptionShort: dto.descriptionShort || null,
        descriptionFull: dto.descriptionFull || null,
        sku: dto.sku || null,
        model: dto.model || null,
        priceCurrency: 'BYN',
        seoTitle: dto.name,
        seoDescription: dto.descriptionShort || dto.name,
      },
    });
  }

  async updateProduct(id: string, dto: AdminUpdateProductDto) {
    await this.ensureProductExists(id);

    return this.prisma.product.update({
      where: { id },
      data: this.productData(dto),
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

  async importSourceProduct(dto: AdminImportSourceProductDto) {
    const parser = await this.resolveSourceParser(dto);

    const product = parser.isDukon
      ? await this.dukonParserService.parseProductUrl(dto.url)
      : parser.is7745
        ? await this.supplier7745ParserService.parseProductUrl(dto.url)
        : parser.isToolsBy
          ? await this.toolsByParserService.parseProductUrl(dto.url)
          : await this.thToolsParserService.parseProductUrl(dto.url);

    return { ok: true, product };
  }

  async previewSourceProduct(dto: AdminImportSourceProductDto) {
    const parser = await this.resolveSourceParser(dto);

    const parsed = parser.isDukon
      ? await this.dukonParserService.previewProductUrl(dto.url)
      : parser.is7745
        ? await this.supplier7745ParserService.previewProductUrl(dto.url)
        : parser.isToolsBy
          ? await this.toolsByParserService.previewProductUrl(dto.url)
          : await this.thToolsParserService.previewProductUrl(dto.url);

    return { ok: true, dryRun: true, parsed };
  }

  async getQueueStats() {
    return this.thToolsParserService.getQueueStats();
  }

  getDukonQueueStats() {
    return this.dukonParserService.getQueueStats();
  }

  getDukonSitemaps(query: AdminDukonSitemapQueryDto) {
    return this.dukonParserService.getSitemaps(query);
  }

  get7745QueueStats() {
    return this.supplier7745ParserService.getQueueStats();
  }

  get7745Sitemaps(query: Admin7745SitemapQueryDto) {
    return this.supplier7745ParserService.getSitemaps(query);
  }

  async getParserRuntimeStatus() {
    return this.runtimeStatus.getAll();
  }

  async getParserHealth() {
    return this.runtimeStatus.getHealth();
  }

  async getSupplierCatalogSummary() {
    const sources = await this.prisma.source.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true },
    });

    return Promise.all(
      sources.map(async (source) => {
        const where = { sourceProducts: { some: { sourceId: source.id } } };
        const [
          total,
          published,
          draft,
          hidden,
          archived,
          withoutPrice,
          withoutImages,
          withoutSku,
        ] = await Promise.all([
          this.prisma.product.count({ where }),
          this.prisma.product.count({
            where: { ...where, status: 'PUBLISHED' },
          }),
          this.prisma.product.count({ where: { ...where, status: 'DRAFT' } }),
          this.prisma.product.count({ where: { ...where, status: 'HIDDEN' } }),
          this.prisma.product.count({
            where: { ...where, status: 'ARCHIVED' },
          }),
          this.prisma.product.count({
            where: { ...where, OR: [{ priceValue: null }, { priceValue: 0 }] },
          }),
          this.prisma.product.count({
            where: { ...where, images: { none: {} } },
          }),
          this.prisma.product.count({
            where: { ...where, OR: [{ sku: null }, { sku: '' }] },
          }),
        ]);

        return {
          source,
          total,
          published,
          draft,
          hidden,
          archived,
          withoutPrice,
          withoutImages,
          withoutSku,
        };
      }),
    );
  }

  async refreshSitemaps() {
    await this.sitemapsService.parseAllSitemapsThTools();
    return this.getQueueStats();
  }

  async processQueuedProducts(limit = 25) {
    await this.thToolsParserService.processSitemapsBatch(limit, 1);
    return this.getQueueStats();
  }

  retrySitemap(id: string) {
    return this.thToolsParserService.retrySitemap(id);
  }

  retryProblemSitemaps() {
    return this.thToolsParserService.retryProblemSitemaps();
  }

  refreshDukonSitemaps() {
    return this.dukonParserService.refreshSitemaps();
  }

  processDukonQueuedProducts(limit = 25) {
    return this.dukonParserService.processSitemapsBatch(limit, 2);
  }

  retryDukonSitemap(id: string) {
    return this.dukonParserService.retrySitemap(id);
  }

  retryProblemDukonSitemaps() {
    return this.dukonParserService.retryProblemSitemaps();
  }

  refresh7745Sitemaps() {
    return this.supplier7745ParserService.refreshSitemaps();
  }

  process7745QueuedProducts(limit = 25) {
    return this.supplier7745ParserService.processSitemapsBatch(limit, 1);
  }

  retry7745Sitemap(id: string) {
    return this.supplier7745ParserService.retrySitemap(id);
  }

  retryProblem7745Sitemaps() {
    return this.supplier7745ParserService.retryProblemSitemaps();
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

  async mergeBrand(id: string, targetBrandId: string) {
    if (id === targetBrandId) {
      throw new BadRequestException('Cannot merge brand into itself');
    }

    await this.ensureBrandExists(id);
    await this.ensureBrandExists(targetBrandId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateMany({
        where: { brandId: id },
        data: { brandId: targetBrandId },
      });
      await tx.brand.delete({ where: { id } });

      return { ok: true, movedProducts: updated.count };
    });
  }

  getCategories() {
    return this.prisma.category.findMany({
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
    });
  }

  getSourceCategories(sourceId?: string) {
    return this.prisma.sourceCategory.findMany({
      where: sourceId ? { sourceId } : {},
      orderBy: [{ source: { name: 'asc' } }, { level: 'asc' }, { name: 'asc' }],
      include: { source: true, mappedCategory: true },
    });
  }

  async mapSourceCategory(id: string, categoryId?: string) {
    if (categoryId) await this.ensureCategoryExists(categoryId);

    return this.prisma.sourceCategory.update({
      where: { id },
      data: { mappedCategoryId: categoryId || null },
      include: { source: true, mappedCategory: true },
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
    const [children, products] = await Promise.all([
      this.prisma.category.count({ where: { parentId: id } }),
      this.prisma.product.count({ where: { categoryId: id } }),
    ]);

    if (children || products) {
      throw new BadRequestException(
        `Cannot delete category: ${children} child categories, ${products} products linked`,
      );
    }

    await this.prisma.category.delete({ where: { id } });
    return { ok: true };
  }

  async getSitemaps(query: AdminSitemapQueryDto) {
    if (query.status) return this.thToolsParserService.getSitemaps(query);
    return this.thToolsParserService.getSitemaps({
      ...query,
      status:
        query.isVisited === undefined
          ? undefined
          : query.isVisited
            ? 'DONE'
            : 'PENDING',
    });
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

  private productData(dto: AdminCreateProductDto | AdminUpdateProductDto) {
    return {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.slug !== undefined ? { slug: dto.slug.trim() } : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      ...(dto.brandId !== undefined ? { brandId: dto.brandId || null } : {}),
      ...(dto.priceValue !== undefined ? { priceValue: dto.priceValue } : {}),
      ...(dto.stockStatus !== undefined
        ? { stockStatus: dto.stockStatus || 'in_stock' }
        : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.descriptionShort !== undefined
        ? { descriptionShort: dto.descriptionShort || null }
        : {}),
      ...(dto.descriptionFull !== undefined
        ? { descriptionFull: dto.descriptionFull || null }
        : {}),
      ...(dto.sku !== undefined ? { sku: dto.sku || null } : {}),
      ...(dto.model !== undefined ? { model: dto.model || null } : {}),
    };
  }

  private async resolveSourceParser(dto: AdminImportSourceProductDto) {
    const source = await this.prisma.source.findUnique({
      where: { id: dto.sourceId },
    });
    if (!source) throw new NotFoundException('Source not found');

    const isDukon =
      source.code === 'dukon' ||
      source.url.includes('dukon.by') ||
      dto.url.includes('dukon.by');
    const isThTools =
      source.code === 'th-tools' ||
      source.url.includes('th-tool.by') ||
      dto.url.includes('th-tool.by');
    const is7745 =
      source.code === '7745' ||
      source.url.includes('7745.by') ||
      dto.url.includes('7745.by');
    const isToolsBy =
      source.code === 'tools-by' ||
      source.url.includes('tools.by') ||
      dto.url.includes('tools.by');
    if (!isThTools && !isDukon && !is7745 && !isToolsBy) {
      throw new BadRequestException('Unsupported source parser');
    }

    return { isDukon, isThTools, is7745, isToolsBy };
  }
}
