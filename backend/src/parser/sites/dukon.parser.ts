import { FALLBACK_CATEGORY_SLUG } from '../../common/constants/catalog';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { SupplierInfo, SupplierQueueParser } from '../supplier-queue-parser';
import {
  DUKON_BASE_URL,
  DukonStockStatus,
  ParsedJsonLdProduct,
  parseSitemapUrls,
  parseCurrentCategoryNames,
  parseChildCategoryLinks,
  parseCatalogProductUrls,
  parseCatalogCategoryUrls,
  parseCatalogPaginationUrls,
  isCatalogUrl,
  isInsideCatalogBranch,
  parseSpecs,
  isProductPage,
  resolveBrand,
  findSpecValue,
  parseImages,
  parseJsonLdProduct,
  parseDescription,
  parseDescriptionShort,
  parseSeoTitle,
  parseMeta,
  parseBreadcrumbNames,
  parseOldPrice,
  parseStockStatus,
  parseModelCodeFromName,
  normalizeCurrency,
  parsePrice,
  absoluteUrl,
  clean,
} from './dukon.parse';

import { PrismaService } from '../../prisma/prisma.service';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { generateSlug } from '../../common/utils/generate-slug';
import { upsertTolerantly } from '../../common/utils/upsert-tolerantly';
import { ParserLogService } from '../parser-log.service';
import { ParserHttpError } from '../parser-http.error';
import { OffersService } from '../../offers/offers.service';
import { CategoryTreeService } from '../categories/category-tree.service';
import { ProductIdentityService } from '../product-identity.service';
import { ParserSettingsService } from '../parser-settings.service';
import { sanitizeSupplierText, sanitizeSupplierTitle } from '../supplier-text';

type SavedCategoryRef = { id: string; mappedCategoryId?: string | null };

const SOURCE_CODE = 'dukon';
/** Failed catalogue pages in a row after which the site is taken to be down. */
const MAX_CONSECUTIVE_PAGE_FAILURES = 5;
const DUKON_SITEMAP_URL = `${DUKON_BASE_URL}/sitemap-iblock-7.xml`;
const DUKON_CATALOG_ROOT_URLS = [`${DUKON_BASE_URL}/catalog/`];

class NonProductPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonProductPageError';
  }
}

@Injectable()
export class DukonParserService extends SupplierQueueParser {
  protected readonly logger = new Logger(DukonParserService.name);
  protected readonly supplier: SupplierInfo = {
    code: 'dukon',
    name: 'Dukon',
    baseUrl: DUKON_BASE_URL,
  };
  constructor(
    prisma: PrismaService,
    parserLogService: ParserLogService,
    offers: OffersService,
    categoryTree: CategoryTreeService,
    settings: ParserSettingsService,
    identity: ProductIdentityService,
  ) {
    super(prisma, parserLogService, offers, categoryTree, settings, identity);
  }

  protected isSkippedError(error: unknown) {
    return error instanceof NonProductPageError;
  }

  async refreshSitemaps() {
    let sitemapError: Error | undefined;
    try {
      const xml = await this.fetchText(DUKON_SITEMAP_URL);
      await this.enqueueUrls(parseSitemapUrls(xml));
    } catch (error) {
      sitemapError = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        'Dukon sitemap unavailable; discovering products from the catalog',
      );
    }
    const discovered = await this.discoverCatalogUrls();
    if (sitemapError && !discovered.discoveredProducts) throw sitemapError;

    // Both legs of the crawl key off the shop's theme classes — `.prod-list__item`
    // for the listing, `a.psection` / `.catmenu a` for the navigation — because
    // dukon's product and category URLs share one shape (`/catalog/<a>/<b>/`),
    // so unlike th-tool.by there is nothing in the URL itself to tell them
    // apart. A re-theme therefore looks like a crawl that walks pages and
    // extracts nothing; and because the sitemap leg keeps answering, the run
    // would record SUCCESS while the catalogue quietly stopped growing. That is
    // the silent parser death this project reports on everywhere else.
    if (discovered.visitedPages > 0 && !discovered.discoveredProducts) {
      throw new Error(
        `Dukon catalog crawl walked ${discovered.visitedPages} pages and found no product links — the listing selectors no longer match the shop's markup`,
      );
    }

    return this.getQueueStats();
  }

  async discoverCatalogUrls() {
    let visitedPages = 0;
    let discoveredProducts = 0;
    let failedPages = 0;

    for (const categoryUrl of DUKON_CATALOG_ROOT_URLS) {
      const result = await this.discoverCatalogBranch(categoryUrl);
      visitedPages += result.visitedPages;
      discoveredProducts += result.discoveredProducts;
      failedPages += result.failedPages;
    }

    return { visitedPages, discoveredProducts, failedPages };
  }

  async discoverCatalogBranch(rootUrl: string) {
    const maxPages = await this.settings.getMaxPages(SOURCE_CODE);
    const delayMs = await this.settings.getRequestDelayMs(SOURCE_CODE);
    const root = absoluteUrl(rootUrl);
    const source = await this.upsertSource();
    const visitedPages = new Set<string>();
    const productUrls = new Set<string>();
    const categoryQueue = [root];
    // Membership for the queue: `categoryQueue.includes()` was a linear scan
    // per link on a crawl of up to thousands of pages.
    const queued = new Set<string>(categoryQueue);
    let failedPages = 0;
    let consecutiveFailures = 0;

    while (categoryQueue.length && visitedPages.size < maxPages) {
      const pageUrl = categoryQueue.shift();
      if (!pageUrl || visitedPages.has(pageUrl)) continue;
      visitedPages.add(pageUrl);

      // One page failing (a removed category, a 403 on one URL) used to abort
      // the whole crawl of up to 5000 pages. It is now skipped and logged;
      // only a run of failures — the site being down — stops the branch.
      let html: string;
      try {
        html = await this.fetchText(pageUrl);
        consecutiveFailures = 0;
      } catch (error) {
        failedPages++;
        consecutiveFailures++;
        this.logger.warn(
          `Dukon catalog page skipped: ${pageUrl} — ${error instanceof Error ? error.message : String(error)}`,
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_PAGE_FAILURES) throw error;
        await this.sleep(delayMs);
        continue;
      }
      const $ = cheerio.load(html);
      await this.saveDiscoveredCategories($, source.id, pageUrl);
      const pageProductUrls = parseCatalogProductUrls($);
      pageProductUrls.forEach((url) => productUrls.add(url));
      await this.enqueueUrls(pageProductUrls);

      for (const paginationUrl of parseCatalogPaginationUrls($, pageUrl)) {
        if (
          isInsideCatalogBranch(paginationUrl, root) &&
          !visitedPages.has(paginationUrl) &&
          !queued.has(paginationUrl)
        ) {
          queued.add(paginationUrl);
          categoryQueue.push(paginationUrl);
        }
      }

      for (const categoryUrl of parseCatalogCategoryUrls($, root)) {
        if (!visitedPages.has(categoryUrl) && !queued.has(categoryUrl)) {
          queued.add(categoryUrl);
          categoryQueue.push(categoryUrl);
        }
      }

      await this.sleep(delayMs);
    }

    return {
      visitedPages: visitedPages.size,
      discoveredProducts: productUrls.size,
      failedPages,
    };
  }

  /** Old builds stored theme assets and certificates as product photos. */
  protected beforeBatch() {
    return this.cleanupStoredProductImages();
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

  async parseProductUrl(url: string) {
    url = this.canonicalUrl(url);
    const res = await fetchWithTimeout(url, {
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new ParserHttpError(res.status, url);

    const html = await res.text();
    const $ = cheerio.load(html);
    const jsonLd = parseJsonLdProduct($);
    const name = clean(
      $('h1').first().text() || jsonLd?.name || parseMeta($, 'og:title'),
    );
    if (!name) throw new Error('Product name was not parsed');
    if (!isProductPage($)) {
      throw new NonProductPageError('URL is not a product page');
    }

    const slug = generateSlug(name);
    const specs = parseSpecs($);
    const sku =
      findSpecValue(specs, 'артикул') ||
      findSpecValue(specs, 'sku') ||
      jsonLd?.sku ||
      jsonLd?.mpn ||
      parseModelCodeFromName(name);
    const model =
      findSpecValue(specs, 'модель') ||
      findSpecValue(specs, 'код модели') ||
      jsonLd?.mpn ||
      parseModelCodeFromName(name);
    const barcode =
      findSpecValue(specs, 'штрихкод') ||
      findSpecValue(specs, 'ean') ||
      findSpecValue(specs, 'gtin') ||
      jsonLd?.barcode;
    const breadcrumbs = parseBreadcrumbNames($);
    const brandName = resolveBrand($, specs, jsonLd?.brand, breadcrumbs);
    const priceValue =
      parsePrice($('.price.gen').first().text()) || jsonLd?.price;
    const priceCurrency = normalizeCurrency(jsonLd?.currency) || 'BYN';
    const oldPrice = parseOldPrice($, priceValue);
    const stockStatus = parseStockStatus($, jsonLd?.availability);
    const descriptionFull =
      parseDescription($) ||
      sanitizeSupplierText(clean(jsonLd?.description || ''));
    const descriptionShort = parseDescriptionShort($, descriptionFull);
    const seoTitle = sanitizeSupplierTitle(parseSeoTitle($)) || name;
    const seoDescription =
      sanitizeSupplierText(parseMeta($, 'description')) ||
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
    const images = parseImages($, name, jsonLd?.images);
    // Keep existing images if a (possibly flaky) re-parse returned none, so a
    // partial fetch never wipes a product's gallery.
    const imagesUpdate =
      images.length > 0 ? { images: { deleteMany: {}, create: images } } : {};

    // Identity is the supplier offer, not the slug — see
    // ProductIdentityService for why upserting on slug lost products.
    const product = await this.identity.save({
      sourceId: source.id,
      // saveSourceProduct keys the offer on the same URL — keep them identical.
      url,
      baseSlug: slug,
      data: {
        update: {
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
          priceCurrency,
          stockStatus,
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
    const jsonLd = parseJsonLdProduct($);
    const name = clean(
      $('h1').first().text() || jsonLd?.name || parseMeta($, 'og:title'),
    );
    if (!name) throw new Error('Product name was not parsed');
    if (!isProductPage($)) {
      throw new NonProductPageError('URL is not a product page');
    }

    const specs = parseSpecs($);
    const sku =
      findSpecValue(specs, 'артикул') ||
      findSpecValue(specs, 'sku') ||
      jsonLd?.sku ||
      jsonLd?.mpn ||
      parseModelCodeFromName(name);
    const breadcrumbs = parseBreadcrumbNames($);
    const brandName = resolveBrand($, specs, jsonLd?.brand, breadcrumbs);
    const priceValue =
      parsePrice($('.price.gen').first().text()) || jsonLd?.price;
    const descriptionFull =
      parseDescription($) ||
      sanitizeSupplierText(clean(jsonLd?.description || ''));

    return {
      source: 'dukon',
      url,
      canonicalUrl: this.parseCanonicalUrl($, url),
      name,
      sku,
      model:
        findSpecValue(specs, 'модель') ||
        findSpecValue(specs, 'код модели') ||
        jsonLd?.mpn ||
        parseModelCodeFromName(name),
      barcode:
        findSpecValue(specs, 'штрихкод') ||
        findSpecValue(specs, 'ean') ||
        findSpecValue(specs, 'gtin') ||
        jsonLd?.barcode,
      brandName,
      priceValue,
      priceCurrency: normalizeCurrency(jsonLd?.currency) || 'BYN',
      oldPrice: parseOldPrice($, priceValue),
      stockStatus: parseStockStatus($, jsonLd?.availability),
      descriptionFull,
      descriptionShort: parseDescriptionShort($, descriptionFull),
      images: parseImages($, name, jsonLd?.images).map((image) => image.url),
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
      .map((_, el) => clean($(el).text()))
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
          // Never listed on the storefront — see FALLBACK_CATEGORY_SLUG.
          isVisible: false,
          level: 0,
          path: [FALLBACK_CATEGORY_SLUG],
          seoTitle: 'Неразобранные товары поставщиков',
          seoDescription: 'Неразобранные товары поставщиков',
        },
      }),
    );
    return category.id;
  }

  private async saveDiscoveredCategories(
    $: cheerio.CheerioAPI,
    sourceId: string,
    pageUrl: string,
  ) {
    const currentNames = parseCurrentCategoryNames($);
    if (!currentNames.length) return;

    await this.saveCategoryPath(sourceId, currentNames, pageUrl);

    for (const child of parseChildCategoryLinks($)) {
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

  private async enqueueUrls(urls: string[]) {
    for (const url of [...new Set(urls)].filter((item) => isCatalogUrl(item))) {
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

  protected canonicalUrl(url: string) {
    const parsed = new URL(absoluteUrl(url));
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }

  private parseCanonicalUrl($: cheerio.CheerioAPI, fallbackUrl: string) {
    const href = $('link[rel="canonical"]').first().attr('href');
    return this.canonicalUrl(href || fallbackUrl);
  }
}
