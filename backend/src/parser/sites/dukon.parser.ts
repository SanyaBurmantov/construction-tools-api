import { FALLBACK_CATEGORY_SLUG } from '../../common/constants/catalog';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../../prisma/prisma.service';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { generateSlug } from '../../common/utils/generate-slug';
import { runWithConcurrency } from '../../common/utils/run-with-concurrency';
import { upsertTolerantly } from '../../common/utils/upsert-tolerantly';
import { ParserLogService } from '../parser-log.service';
import { ParserHttpError, isGoneError } from '../parser-http.error';
import { BatchOutcome, countOutcome, emptyBatchResult } from '../batch-result';
import { OffersService } from '../../offers/offers.service';
import { CategoryTreeService } from '../categories/category-tree.service';
import { ProductIdentityService } from '../product-identity.service';
import { ParserSettingsService } from '../parser-settings.service';

type SavedCategoryRef = { id: string; mappedCategoryId?: string | null };
type DukonStockStatus = 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown';
type JsonRecord = Record<string, unknown>;

type ParsedJsonLdProduct = {
  name?: string;
  description?: string;
  sku?: string;
  mpn?: string;
  barcode?: string;
  brand?: string;
  images: string[];
  price?: number;
  currency?: string;
  availability?: string;
  raw?: JsonRecord;
};

const SOURCE_CODE = 'dukon';
const DUKON_BASE_URL = 'https://dukon.by';
const DUKON_SITEMAP_URL = `${DUKON_BASE_URL}/sitemap-iblock-7.xml`;
const DUKON_CATALOG_ROOT_URLS = [`${DUKON_BASE_URL}/catalog/`];

class NonProductPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonProductPageError';
  }
}

/** Longer than this and the "brand" is an address or a description. */
const MAX_BRAND_LENGTH = 40;

/**
 * Legal-entity and address markers. dukon's "Производитель" field frequently
 * holds the manufacturer's company record rather than the brand.
 */
// `\b` is ASCII-only in JavaScript, so it never matches before а Cyrillic
// letter — the address markers need an explicit start-or-separator instead.
const LEGAL_ENTITY =
  /(^|[\s"«(,])(ООО|ОАО|ЗАО|ОДО|ЧУП|УП|ИП|ПАО|АО|GmbH|LLC|Ltd|Inc)([\s".,»)]|$)|(^|[\s,])(г|ул|пер|пр-т|просп|д|оф|корп)\./i;

@Injectable()
export class DukonParserService {
  private readonly logger = new Logger(DukonParserService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly parserLogService: ParserLogService,
    private readonly offers: OffersService,
    private readonly categoryTree: CategoryTreeService,
    private readonly settings: ParserSettingsService,
    private readonly identity: ProductIdentityService,
  ) {}

  async refreshSitemaps() {
    let sitemapError: Error | undefined;
    try {
      const xml = await this.fetchText(DUKON_SITEMAP_URL);
      await this.enqueueUrls(this.parseSitemapUrls(xml));
    } catch (error) {
      sitemapError = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        'Dukon sitemap unavailable; discovering products from the catalog',
      );
    }
    const discovered = await this.discoverCatalogUrls();
    if (sitemapError && !discovered.discoveredProducts) throw sitemapError;

    return this.getQueueStats();
  }

  async discoverCatalogUrls() {
    let visitedPages = 0;
    let discoveredProducts = 0;

    for (const categoryUrl of DUKON_CATALOG_ROOT_URLS) {
      const result = await this.discoverCatalogBranch(categoryUrl);
      visitedPages += result.visitedPages;
      discoveredProducts += result.discoveredProducts;
    }

    return { visitedPages, discoveredProducts };
  }

  async discoverCatalogBranch(rootUrl: string) {
    const maxPages = await this.settings.getMaxPages(SOURCE_CODE);
    const delayMs = await this.settings.getRequestDelayMs(SOURCE_CODE);
    const root = this.absoluteUrl(rootUrl);
    const source = await this.upsertSource();
    const visitedPages = new Set<string>();
    const productUrls = new Set<string>();
    const categoryQueue = [root];

    while (categoryQueue.length && visitedPages.size < maxPages) {
      const pageUrl = categoryQueue.shift();
      if (!pageUrl || visitedPages.has(pageUrl)) continue;
      visitedPages.add(pageUrl);

      const html = await this.fetchText(pageUrl);
      const $ = cheerio.load(html);
      await this.saveDiscoveredCategories($, source.id, pageUrl);
      const pageProductUrls = this.parseCatalogProductUrls($);
      pageProductUrls.forEach((url) => productUrls.add(url));
      await this.enqueueUrls(pageProductUrls);

      for (const paginationUrl of this.parseCatalogPaginationUrls($, pageUrl)) {
        if (
          this.isInsideCatalogBranch(paginationUrl, root) &&
          !visitedPages.has(paginationUrl) &&
          !categoryQueue.includes(paginationUrl)
        ) {
          categoryQueue.push(paginationUrl);
        }
      }

      for (const categoryUrl of this.parseCatalogCategoryUrls($, root)) {
        if (
          !visitedPages.has(categoryUrl) &&
          !categoryQueue.includes(categoryUrl)
        ) {
          categoryQueue.push(categoryUrl);
        }
      }

      await this.sleep(delayMs);
    }

    return {
      visitedPages: visitedPages.size,
      discoveredProducts: productUrls.size,
    };
  }

  async getQueueStats() {
    const [queued, visited, failed, skipped] = await Promise.all([
      this.prisma.sitemapsDukon.count({ where: { status: 'PENDING' } }),
      this.prisma.sitemapsDukon.count({ where: { status: 'DONE' } }),
      this.prisma.sitemapsDukon.count({ where: { status: 'FAILED' } }),
      this.prisma.sitemapsDukon.count({ where: { status: 'SKIPPED' } }),
    ]);

    return {
      queued,
      visited,
      failed,
      skipped,
      total: queued + visited + failed + skipped,
    };
  }

  async getSitemaps(query: {
    search?: string;
    status?: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'PROBLEM';
    page?: number;
    limit?: number;
  }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = {
      ...(query.search
        ? { url: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
      ...(query.status === 'PROBLEM'
        ? { status: { in: ['FAILED', 'SKIPPED'] } }
        : query.status
          ? { status: query.status }
          : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.sitemapsDukon.findMany({
        where,
        orderBy: [{ status: 'asc' }, { url: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sitemapsDukon.count({ where }),
    ]);

    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async retrySitemap(id: string) {
    return this.prisma.sitemapsDukon.update({
      where: { id },
      data: {
        isVisited: false,
        status: 'PENDING',
        lastError: null,
        visitedAt: null,
      },
    });
  }

  async retryProblemSitemaps() {
    return this.prisma.sitemapsDukon.updateMany({
      where: { status: { in: ['FAILED', 'SKIPPED'] } },
      data: {
        isVisited: false,
        status: 'PENDING',
        lastError: null,
        visitedAt: null,
      },
    });
  }

  async revalidateAllSitemaps() {
    return this.prisma.sitemapsDukon.updateMany({
      data: {
        isVisited: false,
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        lastTriedAt: null,
        visitedAt: null,
      },
    });
  }

  async processSitemapsBatch(limit = 25, concurrency = 2) {
    const delayMs = await this.settings.getRequestDelayMs(SOURCE_CODE);
    await this.cleanupStoredProductImages();
    await this.publishDraftProducts();

    const urls = await this.prisma.sitemapsDukon.findMany({
      where: { status: 'PENDING' },
      orderBy: [{ visitedAt: { sort: 'asc', nulls: 'first' } }, { url: 'asc' }],
      take: limit,
    });

    const batch = emptyBatchResult();
    await runWithConcurrency(urls, concurrency, async (entry) => {
      await this.sleep(delayMs);
      countOutcome(batch, await this.processSitemapUrl(entry.url));
    });
    return { ...(await this.getQueueStats()), batch };
  }

  async publishDraftProducts() {
    return this.prisma.product.updateMany({
      where: {
        status: 'DRAFT',
        sourceProducts: { some: { source: { code: 'dukon' } } },
      },
      data: { status: 'PUBLISHED' },
    });
  }

  async cleanupStoredProductImages() {
    return this.prisma.productImage.deleteMany({
      where: {
        product: { sourceProducts: { some: { source: { code: 'dukon' } } } },
        OR: [
          { url: { contains: '/local/templates/' } },
          { url: { contains: '/include/' } },
          { url: { contains: '/resize_cache/' } },
          { url: { contains: 'sertifikat', mode: 'insensitive' } },
          { url: { contains: 'certificate', mode: 'insensitive' } },
        ],
      },
    });
  }

  async processSitemapUrl(url: string): Promise<BatchOutcome> {
    await this.prisma.sitemapsDukon.updateMany({
      where: { url },
      data: { attempts: { increment: 1 }, lastTriedAt: new Date() },
    });

    try {
      const product = await this.parseProductUrl(url);
      await this.prisma.sitemapsDukon.updateMany({
        where: { url },
        data: {
          isVisited: true,
          status: 'DONE',
          lastError: null,
          visitedAt: new Date(),
        },
      });
      void product;
      return 'DONE';
    } catch (error) {
      if (isGoneError(error)) {
        const source = await this.upsertSource();
        await this.offers.delistOffer(source.id, this.canonicalUrl(url));
        await this.prisma.sitemapsDukon.updateMany({
          where: { url },
          data: {
            isVisited: true,
            status: 'SKIPPED',
            lastError: 'Removed by supplier (404/410)',
            visitedAt: new Date(),
          },
        });
        return 'DELISTED';
      }
      const isSkipped = error instanceof NonProductPageError;
      if (!isSkipped) {
        await this.parserLogService.addError(url, error);
      }
      await this.prisma.sitemapsDukon.updateMany({
        where: { url },
        data: {
          isVisited: true,
          status: isSkipped ? 'SKIPPED' : 'FAILED',
          lastError: error instanceof Error ? error.message : String(error),
          visitedAt: new Date(),
        },
      });
      if (isSkipped) {
        console.warn(`Skipped non-product Dukon URL: ${url}`);
      } else {
        console.error(`Error processing ${url}`, error);
      }
      return isSkipped ? 'SKIPPED' : 'FAILED';
    }
  }

  async parseProductUrl(url: string) {
    url = this.canonicalUrl(url);
    const res = await fetchWithTimeout(url, {
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new ParserHttpError(res.status, url);

    const html = await res.text();
    const $ = cheerio.load(html);
    const jsonLd = this.parseJsonLdProduct($);
    const name = this.clean(
      $('h1').first().text() || jsonLd?.name || this.parseMeta($, 'og:title'),
    );
    if (!name) throw new Error('Product name was not parsed');
    if (!this.isProductPage($)) {
      throw new NonProductPageError('URL is not a product page');
    }

    const slug = generateSlug(name);
    const specs = this.parseSpecs($);
    const sku =
      this.findSpecValue(specs, 'артикул') ||
      this.findSpecValue(specs, 'sku') ||
      jsonLd?.sku ||
      jsonLd?.mpn ||
      this.parseModelCodeFromName(name);
    const model =
      this.findSpecValue(specs, 'модель') ||
      this.findSpecValue(specs, 'код модели') ||
      jsonLd?.mpn ||
      this.parseModelCodeFromName(name);
    const barcode =
      this.findSpecValue(specs, 'штрихкод') ||
      this.findSpecValue(specs, 'ean') ||
      this.findSpecValue(specs, 'gtin') ||
      jsonLd?.barcode;
    const breadcrumbs = this.parseBreadcrumbNames($);
    const brandName = this.resolveBrand($, specs, jsonLd?.brand, breadcrumbs);
    const priceValue =
      this.parsePrice($('.price.gen').first().text()) || jsonLd?.price;
    const priceCurrency = this.normalizeCurrency(jsonLd?.currency) || 'BYN';
    const oldPrice = this.parseOldPrice($, priceValue);
    const stockStatus = this.parseStockStatus($, jsonLd?.availability);
    const descriptionFull =
      this.parseDescription($) || this.clean(jsonLd?.description || '');
    const descriptionShort = this.parseDescriptionShort($, descriptionFull);
    const seoTitle = this.parseSeoTitle($) || name;
    const seoDescription =
      this.parseMeta($, 'description') ||
      descriptionShort ||
      descriptionFull ||
      name;
    const canonicalUrl = this.parseCanonicalUrl($, url);
    const source = await this.upsertSource();
    await this.ensureAllowedCategory(source.id, breadcrumbs);
    const { sourceCategoryId, categoryId } = await this.parseAndSaveCategories(
      $,
      source.id,
    );
    const brandId = brandName
      ? await this.identity.upsertBrand(brandName)
      : undefined;
    const images = this.parseImages($, name, jsonLd?.images);
    // Keep existing images if a (possibly flaky) re-parse returned none, so a
    // partial fetch never wipes a product's gallery.
    const imagesUpdate =
      images.length > 0 ? { images: { deleteMany: {}, create: images } } : {};
    // Status of the product THIS offer belongs to. Looking it up by slug
    // could republish an unrelated product that merely shares the name.
    const existingProductId = await this.identity.findByOffer(source.id, url);
    const existingProduct = existingProductId
      ? await this.prisma.product.findUnique({
          where: { id: existingProductId },
          select: { status: true },
        })
      : null;
    const statusUpdate =
      existingProduct?.status === 'DRAFT'
        ? { status: 'PUBLISHED' as const }
        : {};

    // Identity is the supplier offer, not the slug — see
    // ProductIdentityService for why upserting on slug lost products.
    const product = await this.identity.save({
      sourceId: source.id,
      // saveSourceProduct keys the offer on the same URL — keep them identical.
      url,
      baseSlug: slug,
      data: {
        update: {
          ...statusUpdate,
          name: name,
          // priceValue/oldPrice are deliberately absent: PricingService owns both
          // so markup rules apply and MANUAL prices aren't clobbered.
          priceCurrency,
          sku,
          model,
          barcode,
          brandId,
          categoryId,
          stockStatus,
          descriptionShort,
          descriptionFull,
          seoTitle,
          seoDescription,
          ...imagesUpdate,
        },
        create: {
          name,
          slug,
          sku,
          brandId,
          categoryId,
          priceValue,
          priceCurrency,
          oldPrice,
          stockStatus,
          status: 'PUBLISHED',
          model,
          barcode,
          descriptionShort,
          descriptionFull,
          seoTitle,
          seoDescription,
          images: { create: images },
        },
      },
    });

    await this.identity.saveSpecifications(specs, product.id, categoryId);
    await this.saveSourceProduct(url, product.id, source.id, sourceCategoryId, {
      name,
      sku,
      model,
      barcode,
      brandName,
      priceValue,
      priceCurrency,
      oldPrice,
      stockStatus,
      descriptionFull,
      descriptionShort,
      seoTitle,
      seoDescription,
      canonicalUrl,
      breadcrumbs,
      images: images.map((image) => image.url),
      specs,
      jsonLd,
    });

    // Offers are saved by now, so the price comes from the cheapest available
    // supplier rather than whichever parser happened to run last. Also refreshes
    // the dedup keys so a newly learned barcode makes the product matchable.
    await this.offers.onProductParsed(product.id);

    return product;
  }

  async previewProductUrl(url: string) {
    const res = await fetchWithTimeout(url, {
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new ParserHttpError(res.status, url);

    const html = await res.text();
    const $ = cheerio.load(html);
    const jsonLd = this.parseJsonLdProduct($);
    const name = this.clean(
      $('h1').first().text() || jsonLd?.name || this.parseMeta($, 'og:title'),
    );
    if (!name) throw new Error('Product name was not parsed');
    if (!this.isProductPage($)) {
      throw new NonProductPageError('URL is not a product page');
    }

    const specs = this.parseSpecs($);
    const sku =
      this.findSpecValue(specs, 'артикул') ||
      this.findSpecValue(specs, 'sku') ||
      jsonLd?.sku ||
      jsonLd?.mpn ||
      this.parseModelCodeFromName(name);
    const breadcrumbs = this.parseBreadcrumbNames($);
    const brandName = this.resolveBrand($, specs, jsonLd?.brand, breadcrumbs);
    const priceValue =
      this.parsePrice($('.price.gen').first().text()) || jsonLd?.price;
    const descriptionFull =
      this.parseDescription($) || this.clean(jsonLd?.description || '');

    return {
      source: 'dukon',
      url,
      canonicalUrl: this.parseCanonicalUrl($, url),
      name,
      sku,
      model:
        this.findSpecValue(specs, 'модель') ||
        this.findSpecValue(specs, 'код модели') ||
        jsonLd?.mpn ||
        this.parseModelCodeFromName(name),
      barcode:
        this.findSpecValue(specs, 'штрихкод') ||
        this.findSpecValue(specs, 'ean') ||
        this.findSpecValue(specs, 'gtin') ||
        jsonLd?.barcode,
      brandName,
      priceValue,
      priceCurrency: this.normalizeCurrency(jsonLd?.currency) || 'BYN',
      oldPrice: this.parseOldPrice($, priceValue),
      stockStatus: this.parseStockStatus($, jsonLd?.availability),
      descriptionFull,
      descriptionShort: this.parseDescriptionShort($, descriptionFull),
      images: this.parseImages($, name, jsonLd?.images).map(
        (image) => image.url,
      ),
      specifications: specs,
      breadcrumbs,
      jsonLd,
    };
  }

  private async saveSourceProduct(
    url: string,
    productId: string,
    sourceId: string,
    sourceCategoryId: string,
    data: {
      name: string;
      sku?: string;
      model?: string;
      barcode?: string;
      brandName?: string;
      priceValue?: number;
      priceCurrency: string;
      oldPrice?: number;
      stockStatus: DukonStockStatus;
      descriptionFull: string;
      descriptionShort?: string;
      seoTitle?: string;
      seoDescription?: string;
      canonicalUrl: string;
      breadcrumbs: string[];
      images: string[];
      specs: { name: string; value: string }[];
      jsonLd?: ParsedJsonLdProduct;
    },
  ) {
    const attributes = Object.fromEntries(
      data.specs.map((spec) => [spec.name, spec.value]),
    );
    const specifications = this.toJson({
      attributes,
      source: {
        code: 'dukon',
        url,
        canonicalUrl: data.canonicalUrl,
        breadcrumbs: data.breadcrumbs,
        brandName: data.brandName,
        model: data.model,
        barcode: data.barcode,
        oldPrice: data.oldPrice,
        stockStatus: data.stockStatus,
        descriptionShort: data.descriptionShort,
        seoTitle: data.seoTitle,
        seoDescription: data.seoDescription,
        jsonLd: data.jsonLd,
        parsedAt: new Date().toISOString(),
      },
    });
    const sourceProductData = {
      sourceId,
      externalId: url,
      url,
      name: data.name,
      sku: data.sku,
      price: data.priceValue,
      currency: data.priceCurrency,
      stock: data.stockStatus === 'in_stock',
      images: data.images,
      description: data.descriptionFull,
      specifications,
      productId,
      sourceCategoryId,
      lastSync: new Date(),
    };

    await upsertTolerantly(() =>
      this.prisma.sourceProduct.upsert({
        where: { sourceId_url: { sourceId, url } },
        update: sourceProductData,
        create: sourceProductData,
      }),
    );
  }

  private async ensureAllowedCategory(sourceId: string, breadcrumbs: string[]) {
    const names = breadcrumbs.filter(
      (name) => !['главная', 'каталог'].includes(name.toLowerCase()),
    );
    const filters = await this.settings.getCategoryFilters(SOURCE_CODE);
    const haystack = names.join(' / ');
    if (
      (filters.include && !new RegExp(filters.include, 'i').test(haystack)) ||
      (filters.exclude && new RegExp(filters.exclude, 'i').test(haystack))
    ) {
      throw new NonProductPageError(`Category is filtered out: ${haystack}`);
    }
    const path: string[] = [];
    const externalIds: string[] = [];
    for (const name of names) {
      const slug = generateSlug(name);
      if (!slug) continue;
      path.push(slug);
      externalIds.push(path.join('/'));
    }
    if (!externalIds.length) return;
    const disabled = await this.prisma.sourceCategory.findFirst({
      where: { sourceId, externalId: { in: externalIds }, isEnabled: false },
      select: { name: true },
    });
    if (disabled)
      throw new NonProductPageError(
        `Category is disabled in admin: ${disabled.name}`,
      );
  }

  private async parseAndSaveCategories(
    $: cheerio.CheerioAPI,
    sourceId: string,
  ) {
    const names = $('.rsbreadcrumb [itemprop="name"]')
      .map((_, el) => this.clean($(el).text()))
      .get()
      .filter((name) => name && name !== 'Главная' && name !== 'Каталог');

    // Canonical tree keyed on the full slug chain — see CategoryTreeService.

    let sourceParentId: string | null = null;
    const sourcePath: string[] = [];
    const categoryPath: string[] = [];
    let sourceCategoryId = '';
    let mappedCategoryId: string | null = null;

    for (const name of names) {
      const slug = generateSlug(name);
      if (!slug) continue;

      sourcePath.push(slug);
      categoryPath.push(slug);
      const externalId = sourcePath.join('/');
      const sourceCategory = (await upsertTolerantly(() =>
        this.prisma.sourceCategory.upsert({
          where: { sourceId_externalId: { sourceId, externalId } },
          update: {
            name,
            slug,
            parentId: sourceParentId,
            level: sourcePath.length - 1,
            path: [...sourcePath],
          },
          create: {
            sourceId,
            externalId,
            name,
            slug,
            parentId: sourceParentId,
            level: sourcePath.length - 1,
            path: [...sourcePath],
          },
        }),
      )) as SavedCategoryRef;

      sourceParentId = sourceCategory.id;
      sourceCategoryId = sourceCategory.id;
      mappedCategoryId = sourceCategory.mappedCategoryId ?? null;
    }

    const leafCategory =
      mappedCategoryId || !names.length
        ? null
        : await this.categoryTree.upsertBranch(names);
    if (sourceCategoryId && (mappedCategoryId || leafCategory)) {
      return {
        sourceCategoryId,
        categoryId: mappedCategoryId || leafCategory!.id,
      };
    }

    const sourceCategory = await upsertTolerantly(() =>
      this.prisma.sourceCategory.upsert({
        where: { sourceId_externalId: { sourceId, externalId: 'dukon' } },
        update: {},
        create: {
          sourceId,
          externalId: 'dukon',
          name: 'Dukon',
          slug: 'dukon',
          level: 0,
          path: ['dukon'],
        },
      }),
    );

    return {
      sourceCategoryId: sourceCategory.id,
      categoryId:
        sourceCategory.mappedCategoryId || (await this.getFallbackCategoryId()),
    };
  }

  private async getFallbackCategoryId() {
    const category = await upsertTolerantly(() =>
      this.prisma.category.upsert({
        where: { slug: FALLBACK_CATEGORY_SLUG },
        update: {},
        create: {
          name: 'Неразобранные товары поставщиков',
          slug: FALLBACK_CATEGORY_SLUG,
          pathKey: FALLBACK_CATEGORY_SLUG,
          level: 0,
          path: [FALLBACK_CATEGORY_SLUG],
          seoTitle: 'Неразобранные товары поставщиков',
          seoDescription: 'Неразобранные товары поставщиков',
        },
      }),
    );
    return category.id;
  }

  private upsertSource() {
    return this.prisma.source.upsert({
      where: { code: 'dukon' },
      update: { name: 'Dukon', url: DUKON_BASE_URL },
      create: { name: 'Dukon', code: 'dukon', url: DUKON_BASE_URL },
    });
  }

  private parseSitemapUrls(xml: string) {
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml) as {
      urlset?: { url?: Array<{ loc?: string }> | { loc?: string } };
    };
    const entries = Array.isArray(parsed.urlset?.url)
      ? parsed.urlset.url
      : parsed.urlset?.url
        ? [parsed.urlset.url]
        : [];

    return entries
      .map((entry) => entry.loc)
      .filter((url): url is string => Boolean(url?.includes('/catalog/')))
      .map((url) => this.absoluteUrl(url));
  }

  private async saveDiscoveredCategories(
    $: cheerio.CheerioAPI,
    sourceId: string,
    pageUrl: string,
  ) {
    const currentNames = this.parseCurrentCategoryNames($);
    if (!currentNames.length) return;

    await this.saveCategoryPath(sourceId, currentNames, pageUrl);

    for (const child of this.parseChildCategoryLinks($)) {
      await this.saveCategoryPath(
        sourceId,
        [...currentNames, child.name],
        child.url,
      );
    }
  }

  private async saveCategoryPath(
    sourceId: string,
    names: string[],
    url?: string,
  ) {
    let sourceParentId: string | null = null;
    const path: string[] = [];

    for (const [index, name] of names.entries()) {
      const slug = generateSlug(name);
      if (!slug) continue;

      path.push(slug);
      const externalId = path.join('/');
      const isLeaf = index === names.length - 1;

      const sourceCategory = (await upsertTolerantly(() =>
        this.prisma.sourceCategory.upsert({
          where: { sourceId_externalId: { sourceId, externalId } },
          update: {
            name,
            slug,
            parentId: sourceParentId,
            level: path.length - 1,
            path: [...path],
            ...(isLeaf && url ? { url: this.canonicalUrl(url) } : {}),
          },
          create: {
            sourceId,
            externalId,
            name,
            slug,
            parentId: sourceParentId,
            level: path.length - 1,
            path: [...path],
            ...(isLeaf && url ? { url: this.canonicalUrl(url) } : {}),
          },
        }),
      )) as SavedCategoryRef;

      sourceParentId = sourceCategory.id;
    }
  }

  private parseCurrentCategoryNames($: cheerio.CheerioAPI) {
    const names = $('.rsbreadcrumb [itemprop="name"]')
      .map((_, el) => this.clean($(el).text()))
      .get()
      .filter((name) => name && name !== 'Главная' && name !== 'Каталог');
    const currentName = this.clean($('h1').first().text());

    if (
      currentName &&
      !['главная', 'каталог'].includes(currentName.toLowerCase()) &&
      names[names.length - 1] !== currentName
    ) {
      names.push(currentName);
    }

    return names;
  }

  private parseChildCategoryLinks($: cheerio.CheerioAPI) {
    const categories = new Map<string, { name: string; url: string }>();

    $('a.parent, a.psection').each((_, el) => {
      const href = $(el).attr('href');
      const url = href ? this.absoluteUrl(href) : undefined;
      const name = this.clean(
        $(el).text() ||
          $(el).attr('title') ||
          $(el).find('img').attr('alt') ||
          '',
      );

      if (url && name && this.isCatalogUrl(url) && !this.hasPagination(url)) {
        categories.set(url, { name, url });
      }
    });

    return [...categories.values()];
  }

  private parseCatalogProductUrls($: cheerio.CheerioAPI) {
    const urls = new Set<string>();

    $('.prod-list__item').each((_, el) => {
      const detailUrl = $(el).attr('data-detail');
      if (detailUrl) urls.add(this.absoluteUrl(detailUrl));

      $(el)
        .find('a.prod-name, .prod-preview a')
        .each((__, link) => {
          const href = $(link).attr('href');
          if (href) urls.add(this.absoluteUrl(href));
        });
    });

    return [...urls];
  }

  private parseCatalogCategoryUrls($: cheerio.CheerioAPI, rootUrl: string) {
    const urls = new Set<string>();

    $('a.parent, a.psection, .catmenu a, .catalogmenu a').each((_, el) => {
      const href = $(el).attr('href');
      const url = href ? this.absoluteUrl(href) : undefined;
      if (
        url &&
        this.isCatalogUrl(url) &&
        !this.hasPagination(url) &&
        this.isInsideCatalogBranch(url, rootUrl)
      ) {
        urls.add(url);
      }
    });

    return [...urls];
  }

  private parseCatalogPaginationUrls($: cheerio.CheerioAPI, pageUrl: string) {
    const urls = new Set<string>();
    const pageCount = Number(
      $('.ajaxpages [data-navpagecount]').first().attr('data-navpagecount'),
    );

    if (Number.isFinite(pageCount) && pageCount > 1) {
      for (let page = 2; page <= pageCount; page += 1) {
        urls.add(this.withPageNumber(pageUrl, page));
      }
    }

    $('#paginator a[href*="PAGEN_1="]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) urls.add(this.absoluteUrl(href));
    });

    return [...urls];
  }

  private async enqueueUrls(urls: string[]) {
    for (const url of [...new Set(urls)].filter((item) =>
      this.isCatalogUrl(item),
    )) {
      await this.prisma.sitemapsDukon.upsert({
        where: { url },
        update: {},
        create: { url, status: 'PENDING' },
      });
    }
  }

  private async fetchText(url: string) {
    const res = await fetchWithTimeout(url, {
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new ParserHttpError(res.status, url);
    return res.text();
  }

  private isCatalogUrl(url: string) {
    return url.startsWith(`${DUKON_BASE_URL}/catalog/`);
  }

  private isInsideCatalogBranch(url: string, rootUrl: string) {
    const parsedUrl = new URL(url);
    const parsedRoot = new URL(rootUrl);
    return parsedUrl.pathname.startsWith(parsedRoot.pathname);
  }

  private hasPagination(url: string) {
    return url.includes('PAGEN_1=');
  }

  private canonicalUrl(url: string) {
    const parsed = new URL(this.absoluteUrl(url));
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }

  private withPageNumber(url: string, page: number) {
    const parsed = new URL(url);
    parsed.searchParams.set('PAGEN_1', String(page));
    return parsed.toString();
  }

  private parseSpecs($: cheerio.CheerioAPI) {
    return $('#properties .groupedprops.table .table__item')
      .map((_, el) => ({
        name: this.clean($(el).find('.name').first().text()),
        value: this.clean($(el).find('.val').first().text()),
      }))
      .get()
      .filter((spec) => spec.name && spec.value);
  }

  private isProductPage($: cheerio.CheerioAPI) {
    const hasDetails = Boolean(
      $('#properties .groupedprops.table .table__item').length ||
      $('.price.gen').length,
    );
    // Dukon marks some category pages as JSON-LD Products. A category listing
    // without its own details must not become a published product.
    if (!hasDetails && $('.prod-list__item').length) return false;
    return hasDetails || Boolean(this.parseJsonLdProduct($).name);
  }

  /**
   * Brand from the spec table, the JSON-LD, or the "Производитель:" line —
   * whichever first yields something that is actually a brand.
   *
   * dukon puts whatever the supplier typed under "Производитель", which is
   * often a legal entity ("ООО «Нордберг Руссия», г. Москва, ул. …") or the
   * product's own category. Either one is worse than no brand at all: an
   * article number only identifies a product *together with its brand*, so a
   * wrong brand silently merges two unrelated products under brand+sku, and
   * unpicking a bad merge is expensive. It also mints a junk brand page.
   */
  private resolveBrand(
    $: cheerio.CheerioAPI,
    specs: { name: string; value: string }[],
    jsonLdBrand: string | undefined,
    breadcrumbs: string[],
  ) {
    const candidates = [
      this.findSpecValue(specs, 'производитель'),
      this.findSpecValue(specs, 'бренд'),
      jsonLdBrand,
      this.parseBrand($),
    ];

    for (const candidate of candidates) {
      const brand = this.sanitizeBrand(candidate, breadcrumbs);
      if (brand) return brand;
    }
    return undefined;
  }

  /** Returns the brand, or undefined when the value is not one. */
  private sanitizeBrand(value: string | undefined, breadcrumbs: string[]) {
    const brand = this.clean(value ?? '');
    if (!brand) return undefined;

    // A brand is a name, not a sentence. Anything this long is an address, a
    // description or a whole company record.
    if (brand.length > MAX_BRAND_LENGTH) return undefined;
    if (LEGAL_ENTITY.test(brand)) return undefined;

    // The product's own category echoed back as a brand. Exact match only, so
    // a genuine name that merely starts with the word survives.
    const normalized = brand.toLowerCase();
    if (
      breadcrumbs.some((crumb) => crumb.trim().toLowerCase() === normalized)
    ) {
      return undefined;
    }

    return brand;
  }

  private parseBrand($: cheerio.CheerioAPI) {
    const text = this.clean(
      $('.parameters-block__text, .prod-proplist__item')
        .filter((_, el) =>
          this.clean($(el).text()).startsWith('Производитель:'),
        )
        .first()
        .text(),
    );

    return text.replace(/^Производитель:\s*/, '') || undefined;
  }

  private findSpecValue(
    specs: { name: string; value: string }[],
    needle: string,
  ) {
    return specs.find((spec) => spec.name.toLowerCase().includes(needle))
      ?.value;
  }

  private parseImages(
    $: cheerio.CheerioAPI,
    name: string,
    jsonLdImages: string[] = [],
  ) {
    const urls = new Set<string>();

    for (const image of jsonLdImages) {
      urls.add(this.absoluteUrl(image));
    }

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).text()) as { image?: string | string[] };
        const images = Array.isArray(data.image) ? data.image : [data.image];
        for (const image of images) {
          if (image) urls.add(this.absoluteUrl(image));
        }
      } catch {
        // Ignore unrelated or invalid schema scripts.
      }
    });

    $(
      '.vertical-slider__el img, .pictures img.genimage, .fancy-slider__slide img.genimage, .bx_bigimages img',
    ).each((_, el) => {
      const src =
        $(el).attr('data-src') || $(el).attr('src') || $(el).attr('href');
      if (!src || !this.isProductImageUrl(src)) {
        return;
      }
      urls.add(this.absoluteUrl(src));
    });

    return [...urls].map((url, order) => ({ url, alt: name, order }));
  }

  private parseJsonLdProduct($: cheerio.CheerioAPI): ParsedJsonLdProduct {
    for (const el of $('script[type="application/ld+json"]').toArray()) {
      try {
        const parsed = JSON.parse($(el).text()) as unknown;
        const product = this.findJsonLdProduct(parsed);
        if (!product) continue;

        const brandValue = product.brand;
        const offersValue = product.offers;
        const brand =
          this.readJsonLdString(this.asRecord(brandValue), 'name') ||
          (typeof brandValue === 'string' ? brandValue : undefined);
        const offers = Array.isArray(offersValue)
          ? (offersValue[0] as JsonRecord | undefined)
          : this.asRecord(offersValue);
        const imagesValue = product.image;
        const images = Array.isArray(imagesValue)
          ? imagesValue.filter(
              (image): image is string => typeof image === 'string',
            )
          : typeof imagesValue === 'string'
            ? [imagesValue]
            : [];
        const offerPrice = offers?.price;

        return {
          name: this.readJsonLdString(product, 'name'),
          description: this.readJsonLdString(product, 'description'),
          sku: this.readJsonLdString(product, 'sku'),
          mpn: this.readJsonLdString(product, 'mpn'),
          barcode:
            this.readJsonLdString(product, 'gtin13') ||
            this.readJsonLdString(product, 'gtin') ||
            this.readJsonLdString(product, 'gtin8'),
          brand,
          images,
          price: this.parsePrice(
            typeof offerPrice === 'string' || typeof offerPrice === 'number'
              ? String(offerPrice)
              : '',
          ),
          currency: this.readJsonLdString(offers, 'priceCurrency'),
          availability: this.readJsonLdString(offers, 'availability'),
          raw: product,
        };
      } catch {
        // Ignore unrelated or invalid schema scripts.
      }
    }

    return { images: [] };
  }

  private findJsonLdProduct(value: unknown): JsonRecord | undefined {
    if (Array.isArray(value)) {
      for (const item of value) {
        const product = this.findJsonLdProduct(item);
        if (product) return product;
      }
      return undefined;
    }

    const record = this.asRecord(value);
    if (!record) return undefined;

    const type = record['@type'];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((item) => String(item).toLowerCase() === 'product')) {
      return record;
    }

    return this.findJsonLdProduct(record['@graph']);
  }

  private asRecord(value: unknown): JsonRecord | undefined {
    return value && typeof value === 'object'
      ? (value as JsonRecord)
      : undefined;
  }

  private readJsonLdString(
    record: JsonRecord | undefined,
    key: string,
  ): string | undefined {
    const value = record?.[key];
    return typeof value === 'string' && value.trim()
      ? this.clean(value)
      : undefined;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private isProductImageUrl(url: string) {
    const normalized = url.toLowerCase();
    return (
      normalized.includes('/upload/') &&
      normalized.includes('/iblock/') &&
      !normalized.includes('/resize_cache/') &&
      !normalized.includes('/local/templates/') &&
      !normalized.includes('/include/') &&
      !normalized.includes('sertifikat') &&
      !normalized.includes('certificate')
    );
  }

  private parseDescription($: cheerio.CheerioAPI) {
    const text = this.clean(
      $('#detailtext, .detailtext, #description, .content.description')
        .first()
        .text(),
    );
    return text.replace(/^Подробная информация\s*array\(0\) \{ \}\s*/, '');
  }

  private parseDescriptionShort(
    $: cheerio.CheerioAPI,
    descriptionFull: string,
  ) {
    const metaDescription = this.parseMeta($, 'description');
    if (metaDescription) return metaDescription;
    return descriptionFull.length > 240
      ? `${descriptionFull.slice(0, 237).trim()}...`
      : descriptionFull || undefined;
  }

  private parseSeoTitle($: cheerio.CheerioAPI) {
    return this.clean(
      this.parseMeta($, 'og:title') || $('title').first().text(),
    );
  }

  private parseMeta($: cheerio.CheerioAPI, name: string) {
    return this.clean(
      $(`meta[name="${name}"], meta[property="${name}"]`)
        .first()
        .attr('content') || '',
    );
  }

  private parseCanonicalUrl($: cheerio.CheerioAPI, fallbackUrl: string) {
    const href = $('link[rel="canonical"]').first().attr('href');
    return this.canonicalUrl(href || fallbackUrl);
  }

  private parseBreadcrumbNames($: cheerio.CheerioAPI) {
    return $('.rsbreadcrumb [itemprop="name"]')
      .map((_, el) => this.clean($(el).text()))
      .get()
      .filter(Boolean);
  }

  private parseOldPrice($: cheerio.CheerioAPI, currentPrice?: number) {
    const candidates = [
      '.old-price',
      '.price-old',
      '.price__old',
      '.oldprice',
      '.price.gen del',
      'del',
    ];

    for (const selector of candidates) {
      const value = this.parsePrice($(selector).first().text());
      if (value && (!currentPrice || value > currentPrice)) return value;
    }

    return undefined;
  }

  private parseStockStatus(
    $: cheerio.CheerioAPI,
    jsonLdAvailability?: string,
  ): DukonStockStatus {
    const availability = jsonLdAvailability?.toLowerCase() || '';
    if (availability.includes('outofstock')) return 'out_of_stock';
    if (availability.includes('preorder')) return 'preorder';
    if (availability.includes('instock')) return 'in_stock';

    const pageText = this.clean(
      $(
        '.availability, .stock, .quantity, .product-info, .detail-product__info',
      )
        .text()
        .toLowerCase(),
    );

    if (/нет в наличии|отсутствует|закончился/.test(pageText)) {
      return 'out_of_stock';
    }
    if (/под заказ|предзаказ|ожидается/.test(pageText)) return 'preorder';
    if (/в наличии|есть в наличии|на складе/.test(pageText)) return 'in_stock';

    return 'unknown';
  }

  private parseModelCodeFromName(name: string) {
    const normalized = this.clean(name);
    const spacedCode = normalized.match(/([A-ZА-Я]{2,}\s+\d[\wА-Яа-я.-]*)$/u);
    if (spacedCode) return spacedCode[1];

    const tailCode = normalized.match(
      /([A-ZА-Я0-9]+[\wА-Яа-я.-]*\d[\wА-Яа-я.-]*)$/u,
    );
    return tailCode?.[1];
  }

  private normalizeCurrency(value?: string) {
    if (!value) return undefined;
    const normalized = value.trim().toUpperCase();
    if (normalized === 'RUB' || normalized === 'RUR') return 'RUB';
    if (normalized === 'BYN' || normalized.includes('BYN')) return 'BYN';
    return /^[A-Z]{3}$/.test(normalized) ? normalized : undefined;
  }

  private parsePrice(value: string) {
    const price = Number.parseFloat(
      value.replace(/[^\d.,]/g, '').replace(',', '.'),
    );
    return Number.isFinite(price) ? price : undefined;
  }

  private absoluteUrl(url: string) {
    if (url.startsWith('http')) return url;
    return `${DUKON_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private clean(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
