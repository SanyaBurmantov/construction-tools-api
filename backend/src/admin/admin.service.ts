import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { rekeyCategory } from '../categories/category-path-alias';
import { PricingService } from '../pricing/pricing.service';
import { ParserJobRequestService } from '../parser/parser-job-request.service';
import { SupplierQueueParser } from '../parser/supplier-queue-parser';
import { QueueSourceCode } from '../parser/queue-table';
import {
  countProducts,
  fromSource,
  NO_IMAGES,
  PUBLISHED,
} from './product-gaps';
import { AdminCreateBrandDto } from './dto/admin-create-brand.dto';
import { AdminCreateCategoryDto } from './dto/admin-create-category.dto';
import { AdminCreateProductDto } from './dto/admin-create-product.dto';
import { AdminUpdateProductDto } from './dto/admin-update-product.dto';
import { AdminProductQueryDto } from './dto/admin-product-query.dto';
import { ThToolsParserService } from '../parser/sites/th-tools-source.parser';
import { DukonParserService } from '../parser/sites/dukon.parser';
import { Supplier7745ParserService } from '../parser/sites/7745-source.parser';
import { ToolsByParserService } from '../parser/sites/tools-by-source.parser';
import { AdminUpdateBrandDto } from './dto/admin-update-brand.dto';
import { AdminUpdateCategoryDto } from './dto/admin-update-category.dto';
import { AdminSitemapQueryDto } from './dto/admin-sitemap-query.dto';
import { ParserLogService } from '../parser/parser-log.service';
import { ParserRuntimeStatusService } from '../parser/parser-runtime-status.service';
import { AdminImportSourceProductDto } from './dto/admin-import-source-product.dto';
import { redirectOldSlug } from '../products/product-slug';
import { IndexNowService, productPath } from '../seo/indexnow.service';

/**
 * A button press waits for its batch inside one HTTP request, so it is capped
 * well below a cron batch — and an unvalidated `limit` from the body could ask
 * for thousands of URLs.
 */
const MAX_MANUAL_BATCH = 50;
const manualBatch = (limit: unknown) => {
  const value = Math.trunc(Number(limit));
  return Number.isFinite(value) && value > 0
    ? Math.min(value, MAX_MANUAL_BATCH)
    : 25;
};

/**
 * Product fields a parse also writes. An admin edit to any of them locks it
 * against the re-parse (`Product.lockedFields`).
 */
const PARSER_OWNED_FIELDS = [
  'name',
  'sku',
  'barcode',
  'model',
  'brandId',
  'categoryId',
  'descriptionShort',
  'descriptionFull',
  'seoTitle',
  'seoDescription',
] as const;

/** The page's own text: a change moves `contentUpdatedAt` (sitemap lastmod). */
const PAGE_TEXT_FIELDS = [
  'name',
  'descriptionShort',
  'descriptionFull',
  'seoTitle',
  'seoDescription',
] as const;

/** Same budget CategoryMergeService gives a subtree rewrite. */
const CATEGORY_TX_OPTIONS = { maxWait: 10_000, timeout: 120_000 };

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly thToolsParserService: ThToolsParserService,
    private readonly dukonParserService: DukonParserService,
    private readonly supplier7745ParserService: Supplier7745ParserService,
    private readonly toolsByParserService: ToolsByParserService,
    private readonly parserLogService: ParserLogService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
    private readonly pricing: PricingService,
    private readonly jobRequests: ParserJobRequestService,
    private readonly indexNow: IndexNowService,
  ) {}

  async getStats() {
    // Revenue counts only orders that weren't cancelled.
    const revenueWhere = { status: { not: OrderStatus.CANCELLED } } as const;
    const since = new Date();
    since.setDate(since.getDate() - 13);
    since.setHours(0, 0, 0, 0);

    const [
      products,
      publishedProducts,
      categories,
      brands,
      sources,
      queuedSitemaps,
      orders,
      newOrders,
      pendingReviews,
      activePromoCodes,
      priceReviewNeeded,
      productsWithoutImages,
      users,
      admins,
      revenue,
      ordersByStatus,
      recentOrders,
      dailyOrders,
      topProducts,
      recentErrors,
      newLeads,
    ] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.product.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.category.count(),
      this.prisma.brand.count(),
      this.prisma.source.count(),
      this.prisma.sitemapsThTools.count({ where: { isVisited: false } }),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: 'NEW' } }),
      this.prisma.review.count({ where: { status: 'PENDING' } }),
      this.prisma.promoCode.count({ where: { isActive: true } }),
      this.prisma.product.count({ where: { priceReviewNeeded: true } }),
      // The single biggest driver of "this shop looks cheap": a grid of grey
      // boxes where product photos should be.
      countProducts(this.prisma, PUBLISHED, NO_IMAGES),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'ADMIN', isActive: true } }),
      this.prisma.order.aggregate({
        where: revenueWhere,
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.order.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          number: true,
          status: true,
          customerName: true,
          total: true,
          currency: true,
          createdAt: true,
        },
      }),
      this.prisma.order.findMany({
        where: { ...revenueWhere, createdAt: { gte: since } },
        select: { createdAt: true, total: true },
      }),
      this.prisma.orderItem.groupBy({
        by: ['productId', 'productName', 'productSlug'],
        where: { productId: { not: null } },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 8,
      }),
      // Drives the «Ошибки» badge in the admin sidebar: server errors of the
      // last day. Indexed on (statusCode, createdAt), so it is a cheap count
      // even when something is failing in a loop.
      this.prisma.errorLog.count({
        where: {
          statusCode: { gte: 500 },
          lastSeenAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.lead.count({ where: { status: 'NEW' } }),
    ]);

    // Bucket the last 14 days client-side; the row count here is small and it
    // keeps empty days in the series so the chart doesn't skip gaps.
    const buckets = new Map<string, { orders: number; revenue: number }>();
    for (let i = 0; i < 14; i += 1) {
      const day = new Date(since);
      day.setDate(since.getDate() + i);
      buckets.set(day.toISOString().slice(0, 10), { orders: 0, revenue: 0 });
    }
    for (const order of dailyOrders) {
      const key = order.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.orders += 1;
        bucket.revenue = Math.round((bucket.revenue + order.total) * 100) / 100;
      }
    }

    return {
      products,
      publishedProducts,
      categories,
      brands,
      sources,
      queuedSitemaps,
      orders,
      newOrders,
      pendingReviews,
      activePromoCodes,
      priceReviewNeeded,
      productsWithoutImages,
      users,
      admins,
      recentErrors,
      newLeads,
      revenueTotal: Math.round((revenue._sum.total ?? 0) * 100) / 100,
      averageOrder: Math.round((revenue._avg.total ?? 0) * 100) / 100,
      ordersByStatus: Object.fromEntries(
        ordersByStatus.map((row) => [row.status, row._count._all]),
      ),
      recentOrders,
      salesSeries: [...buckets.entries()].map(([date, value]) => ({
        date,
        ...value,
      })),
      topProducts: topProducts.map((row) => ({
        productId: row.productId,
        name: row.productName,
        slug: row.productSlug,
        quantity: row._sum.quantity ?? 0,
        revenue: Math.round((row._sum.lineTotal ?? 0) * 100) / 100,
      })),
      bySource: await this.salesBySource(),
    };
  }

  /**
   * Orders and leads per traffic source over the last 90 days — the answer
   * to «what does the site actually bring». Cancelled orders are left out;
   * rows recorded before attribution existed show as «не записан».
   */
  private async salesBySource() {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [orders, leads] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['trafficSource'],
        where: {
          createdAt: { gte: since },
          status: { not: OrderStatus.CANCELLED },
        },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.lead.groupBy({
        by: ['trafficSource'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);
    const rows = new Map<
      string,
      { source: string; orders: number; revenue: number; leads: number }
    >();
    const row = (source: string | null) => {
      const key = source ?? 'не записан';
      const existing = rows.get(key) ?? {
        source: key,
        orders: 0,
        revenue: 0,
        leads: 0,
      };
      rows.set(key, existing);
      return existing;
    };
    for (const o of orders) {
      const r = row(o.trafficSource);
      r.orders = o._count._all;
      r.revenue = Math.round((o._sum.total ?? 0) * 100) / 100;
    }
    for (const l of leads) row(l.trafficSource).leads = l._count._all;
    return [...rows.values()].sort(
      (a, b) =>
        b.revenue - a.revenue || b.orders - a.orders || b.leads - a.leads,
    );
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

  /**
   * A product made by hand is the admin's from the start: its status is
   * ADMIN (no automation publishes or hides it) and a price typed in is a
   * MANUAL price, which no parse overwrites.
   */
  async createProduct(dto: AdminCreateProductDto) {
    const slug = dto.slug.trim();
    await this.ensureProductSlugFree(slug);
    return this.prisma.product.create({
      data: {
        name: dto.name.trim(),
        slug,
        categoryId: dto.categoryId,
        brandId: dto.brandId || null,
        priceValue: dto.priceValue,
        oldPrice: dto.oldPrice ?? null,
        costPrice: dto.costPrice ?? null,
        pricingMode:
          dto.pricingMode ?? (dto.priceValue != null ? 'MANUAL' : 'AUTO'),
        stockStatus: dto.stockStatus || 'in_stock',
        stockQuantity: dto.stockQuantity ?? null,
        status: dto.status || 'PUBLISHED',
        statusSource: 'ADMIN',
        descriptionShort: dto.descriptionShort || null,
        descriptionFull: dto.descriptionFull || null,
        sku: dto.sku || null,
        model: dto.model || null,
        priceCurrency: dto.priceCurrency || 'BYN',
        seoTitle: dto.seoTitle || dto.name,
        seoDescription: dto.seoDescription || dto.descriptionShort || dto.name,
      },
    });
  }

  /**
   * Three rules make this more than a `product.update`:
   *
   * - **Corrected fields stay corrected.** Every field an admin edits that a
   *   parser also writes joins `lockedFields`, which the re-parse skips —
   *   the daily refresh used to put the supplier's name or category back.
   * - **A typed price is a MANUAL price** (unless the request says AUTO), and
   *   the change goes to PriceHistory. Writing `priceValue` on an AUTO
   *   product was silently undone by the next parse. Switching back to AUTO
   *   re-prices from the cost through PricingService.
   * - **A status set here is the admin's** (`statusSource = ADMIN`): the
   *   automatic publish/hide rules leave it alone. A renamed slug leaves a
   *   ProductRedirect behind so indexed URLs keep working.
   */
  async updateProduct(id: string, dto: AdminUpdateProductDto) {
    const current = await this.ensureProductExists(id);
    const data: Prisma.ProductUncheckedUpdateInput = this.productData(dto);

    const slug = dto.slug?.trim();
    const slugChanged = slug !== undefined && slug !== current.slug;
    if (slugChanged) await this.ensureProductSlugFree(slug, id);

    const locked = PARSER_OWNED_FIELDS.filter(
      (field) => (dto as Record<string, unknown>)[field] !== undefined,
    );
    if (locked.length) {
      data.lockedFields = [...new Set([...current.lockedFields, ...locked])];
    }
    if (dto.status !== undefined) data.statusSource = 'ADMIN';

    // The page text changed: the sitemap's lastmod moves and Yandex is told.
    const textChanged =
      slugChanged ||
      PAGE_TEXT_FIELDS.some((field) => {
        const value = (dto as Record<string, unknown>)[field];
        return (
          value !== undefined &&
          value !== (current as Record<string, unknown>)[field]
        );
      });
    if (textChanged) data.contentUpdatedAt = new Date();
    // Saving the product is the admin's answer to a supplier rename.
    data.supplierNameChange = Prisma.DbNull;
    data.supplierNameChangedAt = null;

    const priceTouched =
      dto.priceValue !== undefined || dto.oldPrice !== undefined;
    const mode = dto.pricingMode ?? (priceTouched ? 'MANUAL' : undefined);
    if (mode) data.pricingMode = mode;
    if (mode === 'AUTO') {
      // The engine owns the price again; a typed value would be overwritten
      // on the next parse anyway, so it is not written at all.
      delete data.priceValue;
      delete data.oldPrice;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.product.update({ where: { id }, data });
      if (slugChanged) {
        await redirectOldSlug(tx, id, current.slug, slug);
      }
      if (
        (data.priceValue !== undefined &&
          row.priceValue !== current.priceValue) ||
        (data.costPrice !== undefined && row.costPrice !== current.costPrice)
      ) {
        await tx.priceHistory.create({
          data: {
            productId: id,
            costPrice: row.costPrice,
            oldPrice: current.priceValue,
            newPrice: row.priceValue,
            reason: 'manual',
          },
        });
      }
      return row;
    });

    if (textChanged) {
      await this.indexNow.enqueue([
        productPath(updated.slug),
        slugChanged ? productPath(current.slug) : null,
      ]);
    }

    if (mode === 'AUTO' && updated.costPrice != null) {
      await this.pricing.applyCost(id, updated.costPrice, {
        preserveOldPrice: true,
      });
      return this.prisma.product.findUnique({ where: { id } });
    }
    return updated;
  }

  /**
   * Archive, not delete. A hard delete cascaded away the product's customer
   * reviews and price history, and the next parse recreated the product as
   * new anyway (its offer pointed nowhere). ARCHIVED with an ADMIN status
   * hides it everywhere and no automation brings it back; the URL 404s like
   * any unpublished product, and an admin can restore it by status.
   */
  async deleteProduct(id: string) {
    await this.ensureProductExists(id);
    await this.prisma.product.update({
      where: { id },
      data: { status: 'ARCHIVED', statusSource: 'ADMIN' },
    });
    return { ok: true, archived: true };
  }

  /** Product slugs are public URLs, unique across products and redirects. */
  private async ensureProductSlugFree(slug: string, exceptId?: string) {
    if (!slug) throw new BadRequestException('Slug не может быть пустым');
    const [taken, redirect] = await Promise.all([
      this.prisma.product.findUnique({
        where: { slug },
        select: { id: true, name: true },
      }),
      this.prisma.productRedirect.findUnique({
        where: { slug },
        select: { productId: true },
      }),
    ]);
    if (taken && taken.id !== exceptId) {
      throw new ConflictException(
        `Slug «${slug}» уже занят товаром «${taken.name}»`,
      );
    }
    if (redirect && redirect.productId !== exceptId) {
      throw new ConflictException(
        `Slug «${slug}» — старый адрес другого товара`,
      );
    }
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

  async getParserRuntimeStatus() {
    return this.runtimeStatus.getAll();
  }

  async getParserHealth() {
    return this.runtimeStatus.getHealth();
  }

  async getParserRuns(key?: string, limit?: number) {
    return this.runtimeStatus.getRuns(key, limit);
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
          countProducts(this.prisma, fromSource(source.id), NO_IMAGES),
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

  /* ------------------------------------------------- supplier queues ---- */

  /**
   * The supplier parser behind a queue. One lookup instead of four copies of
   * every queue method — the routes stay per supplier, the code does not.
   */
  private queueParser(code: QueueSourceCode): SupplierQueueParser {
    switch (code) {
      case 'th-tools':
        return this.thToolsParserService;
      case 'dukon':
        return this.dukonParserService;
      case '7745':
        return this.supplier7745ParserService;
      case 'tools-by':
        return this.toolsByParserService;
    }
  }

  queueStats(code: QueueSourceCode) {
    return this.queueParser(code).getQueueStats();
  }

  /** `isVisited` is the old filter of the th-tools screen; status wins. */
  queueRows(code: QueueSourceCode, query: AdminSitemapQueryDto) {
    const status =
      query.status ??
      (query.isVisited === undefined
        ? undefined
        : query.isVisited
          ? 'DONE'
          : 'PENDING');
    return this.queueParser(code).getSitemaps({ ...query, status });
  }

  /**
   * Discovery for one supplier (sitemap, or a catalogue crawl where there is
   * none), under the same per-source lock as the cron jobs.
   */
  async refreshQueue(code: QueueSourceCode) {
    // Run by the worker; this request waits for it (see ParserJobRequestService).
    await this.jobRequests.runAndWait(code, 'refresh');
    return this.queueParser(code).getQueueStats();
  }

  async processQueue(code: QueueSourceCode, limit: unknown) {
    await this.jobRequests.runAndWait(code, 'process', {
      limit: manualBatch(limit),
    });
    return this.queueParser(code).getQueueStats();
  }

  retryQueueRow(code: QueueSourceCode, id: string) {
    return this.queueParser(code).retrySitemap(id);
  }

  retryQueueProblems(code: QueueSourceCode) {
    return this.queueParser(code).retryProblemSitemaps();
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
    // A BRAND pricing rule whose brand is gone never matches again and keeps
    // showing in the rules list as if it worked.
    const rules = await this.prisma.pricingRule.count({
      where: { brandId: id },
    });
    if (rules) {
      throw new BadRequestException(
        `К бренду привязано правил наценки: ${rules}. Удалите их или объедините бренд с другим.`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.product.updateMany({
        where: { brandId: id },
        data: { brandId: null },
      }),
      this.prisma.brand.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  async mergeBrand(id: string, targetBrandId: string) {
    if (id === targetBrandId) {
      throw new BadRequestException('Cannot merge brand into itself');
    }

    await this.ensureBrandExists(id);
    await this.ensureBrandExists(targetBrandId);

    return this.prisma.$transaction(async (tx) => {
      const source = await tx.brand.findUniqueOrThrow({
        where: { id },
        select: { slug: true },
      });
      const updated = await tx.product.updateMany({
        where: { brandId: id },
        data: { brandId: targetBrandId },
      });
      await tx.pricingRule.updateMany({
        where: { brandId: id },
        data: { brandId: targetBrandId },
      });
      // The supplier keeps spelling the old brand; without the alias the next
      // parse recreates it and pulls its products back.
      await tx.brandAlias.updateMany({
        where: { brandId: id },
        data: { brandId: targetBrandId },
      });
      await tx.brandAlias.upsert({
        where: { slug: source.slug },
        create: { slug: source.slug, brandId: targetBrandId },
        update: { brandId: targetBrandId },
      });
      await tx.brand.delete({ where: { id } });

      return { ok: true, movedProducts: updated.count };
    });
  }

  /**
   * Flat category list for the admin tree.
   *
   * Counts come along because the page needs them to decide anything: whether
   * a branch is safe to hide, which "Прочее" is the real one, whether a row is
   * deletable. It rendered `row._count.products` already — the payload just
   * never carried it, so the column was always blank.
   */
  getCategories() {
    return this.prisma.category.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { products: true, children: true } },
      },
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
    const slug = dto.slug.trim();
    const parent = dto.parentId
      ? await this.prisma.category.findUnique({ where: { id: dto.parentId } })
      : null;
    if (dto.parentId && !parent) {
      throw new NotFoundException('Parent category not found');
    }
    await this.ensureSlugFree(slug);

    return this.prisma.category.create({
      data: {
        name: dto.name.trim(),
        slug,
        parentId: dto.parentId,
        description: dto.description,
        image: dto.image,
        level: parent ? parent.level + 1 : 0,
        path: parent ? [...parent.path, slug] : [slug],
        // Identity must match what the parsers build, or a hand-made category
        // and a parsed one at the same place in the tree become two rows.
        pathKey: parent ? `${parent.pathKey}/${slug}` : slug,
        seoTitle: dto.seoTitle?.trim() || dto.name.trim(),
        seoDescription:
          dto.seoDescription?.trim() || dto.description || dto.name.trim(),
        sortOrder: dto.sortOrder ?? 0,
        isVisible: dto.isVisible ?? true,
        isFeatured: dto.isFeatured ?? false,
      },
    });
  }

  /**
   * Edit one category. Everything the storefront reads is editable here,
   * including the display settings (`sortOrder` / `isVisible` / `isFeatured`)
   * that decide where it appears in the menu.
   *
   * Two things make this more than a `category.update`:
   *
   * - **Moving or renaming rewrites identity.** `pathKey` is the full slug
   *   chain and is what the parsers upsert on, so a move that only changed
   *   `parentId` left the row keyed at its old position and the next parse
   *   recreated it there — the category came back where the admin moved it
   *   from. `path`, `level` and `pathKey` are rebuilt for the whole subtree,
   *   the same way `CategoryMergeService` does it.
   * - **A renamed slug keeps its old URL.** The old slug becomes a
   *   `CategoryRedirect`, which `GET /categories/:slug` and the `categorySlug`
   *   product filter already follow, so indexed links and anything a customer
   *   bookmarked keep resolving instead of 404ing.
   */
  async updateCategory(id: string, dto: AdminUpdateCategoryDto) {
    const current = await this.ensureCategoryExists(id);

    const categories = await this.prisma.category.findMany({
      select: {
        id: true,
        parentId: true,
        slug: true,
        pathKey: true,
        level: true,
        path: true,
      },
    });
    const descendants = this.collectSubtree(id, categories);

    const parentId =
      dto.parentId === undefined ? current.parentId : dto.parentId || null;
    if (parentId === id) {
      throw new BadRequestException('Category cannot be its own parent');
    }
    if (parentId && descendants.some((row) => row.id === parentId)) {
      throw new BadRequestException(
        'Cannot move a category into its own subcategory',
      );
    }
    const parent = parentId
      ? categories.find((row) => row.id === parentId)
      : null;
    if (parentId && !parent) {
      throw new NotFoundException('Parent category not found');
    }

    const slug = dto.slug?.trim() || current.slug;
    if (slug !== current.slug) await this.ensureSlugFree(slug, id);

    const parentPath = parent?.path ?? [];
    const path = [...parentPath, slug];
    const moved =
      parentId !== current.parentId ||
      path.join('/') !== current.path.join('/');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.slug !== undefined ? { slug } : {}),
          ...(dto.parentId !== undefined ? { parentId } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.image !== undefined ? { image: dto.image || null } : {}),
          ...(dto.seoTitle !== undefined
            ? {
                seoTitle:
                  dto.seoTitle.trim() || dto.name?.trim() || current.name,
              }
            : {}),
          ...(dto.seoDescription !== undefined
            ? { seoDescription: dto.seoDescription }
            : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isVisible !== undefined ? { isVisible: dto.isVisible } : {}),
          ...(dto.isFeatured !== undefined
            ? { isFeatured: dto.isFeatured }
            : {}),
          ...(moved ? { path, level: parentPath.length } : {}),
        },
      });
      if (moved) {
        // Parser identity follows the move; the old chain stays an alias.
        await rekeyCategory(tx, id, current.pathKey, path.join('/'));
      }

      if (slug !== current.slug) {
        // The new slug may itself be an alias left behind by an earlier
        // rename; a row cannot be both a category and a redirect.
        await tx.categoryRedirect.deleteMany({ where: { slug } });
        await tx.categoryRedirect.upsert({
          where: { slug: current.slug },
          create: { slug: current.slug, categoryId: id },
          update: { categoryId: id },
        });
      }

      if (moved) {
        await this.rebuildSubtreePaths(tx, id, path, categories);
      }

      return updated;
      // A move rewrites every descendant row by row; Prisma's default 5 s
      // interactive-transaction timeout failed moves of large branches.
    }, CATEGORY_TX_OPTIONS);
  }

  /** Every category below `id`, breadth-first. */
  private collectSubtree<T extends { id: string; parentId: string | null }>(
    id: string,
    categories: T[],
  ): T[] {
    const childrenByParent = new Map<string, T[]>();
    for (const row of categories) {
      if (!row.parentId) continue;
      const list = childrenByParent.get(row.parentId) ?? [];
      list.push(row);
      childrenByParent.set(row.parentId, list);
    }

    const result: T[] = [];
    const queue = [...(childrenByParent.get(id) ?? [])];
    while (queue.length) {
      const current = queue.shift() as T;
      result.push(current);
      queue.push(...(childrenByParent.get(current.id) ?? []));
    }
    return result;
  }

  /**
   * Rewrites `path` / `level` / `pathKey` under a category that just moved.
   * Each row keeps its own slug; only the chain above it changes.
   */
  private async rebuildSubtreePaths(
    tx: Prisma.TransactionClient,
    rootId: string,
    rootPath: string[],
    categories: Array<{
      id: string;
      parentId: string | null;
      slug: string;
      pathKey: string;
    }>,
  ) {
    const childrenByParent = new Map<string, typeof categories>();
    for (const row of categories) {
      if (!row.parentId) continue;
      const list = childrenByParent.get(row.parentId) ?? [];
      list.push(row);
      childrenByParent.set(row.parentId, list);
    }

    const walk = async (parentId: string, parentPath: string[]) => {
      for (const child of childrenByParent.get(parentId) ?? []) {
        const path = [...parentPath, child.slug];
        await rekeyCategory(tx, child.id, child.pathKey, path.join('/'), {
          path,
          level: parentPath.length,
        });
        await walk(child.id, path);
      }
    };

    await walk(rootId, rootPath);
  }

  /** A slug is a public URL and is unique across categories and aliases. */
  private async ensureSlugFree(slug: string, exceptId?: string) {
    const taken = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true, name: true },
    });
    if (taken && taken.id !== exceptId) {
      throw new BadRequestException(
        `Slug "${slug}" is already used by category "${taken.name}"`,
      );
    }
  }

  /**
   * Renumber a row of sibling categories. Positions start at 1, so 0 keeps
   * meaning "never curated" and those rows stay sorted by product count.
   */
  async reorderCategories(ids: string[]) {
    const found = await this.prisma.category.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new NotFoundException('Some categories no longer exist');
    }

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.category.update({
          where: { id },
          data: { sortOrder: index + 1 },
        }),
      ),
    );
    return { ok: true, updated: ids.length };
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

    // Spec definitions are RESTRICT on the category, and values can outlive
    // the products that moved away — both must go first, in one transaction,
    // or the delete fails half-way with a 500.
    await this.prisma.$transaction([
      this.prisma.productSpecification.deleteMany({
        where: { specification: { categoryId: id } },
      }),
      this.prisma.specification.deleteMany({ where: { categoryId: id } }),
      this.prisma.category.delete({ where: { id } }),
    ]);
    return { ok: true };
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
    return product;
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
      ...(dto.oldPrice !== undefined ? { oldPrice: dto.oldPrice ?? null } : {}),
      ...(dto.costPrice !== undefined
        ? { costPrice: dto.costPrice ?? null }
        : {}),
      ...(dto.pricingMode !== undefined
        ? { pricingMode: dto.pricingMode }
        : {}),
      ...(dto.priceCurrency !== undefined
        ? { priceCurrency: dto.priceCurrency || 'BYN' }
        : {}),
      ...(dto.stockQuantity !== undefined
        ? { stockQuantity: dto.stockQuantity ?? null }
        : {}),
      ...(dto.seoTitle !== undefined ? { seoTitle: dto.seoTitle } : {}),
      ...(dto.seoDescription !== undefined
        ? { seoDescription: dto.seoDescription }
        : {}),
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
