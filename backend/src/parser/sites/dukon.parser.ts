import { FALLBACK_CATEGORY_SLUG } from '../../common/constants/catalog';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import {
  CatalogCrawlEntry,
  MAX_CATALOG_PAGE_FAILURES,
  MAX_CONSECUTIVE_CATALOG_FAILURES,
  SupplierInfo,
  SupplierQueueParser,
} from '../supplier-queue-parser';
import {
  DUKON_BASE_URL,
  DUKON_BRANDS_URL,
  DukonPageKind,
  DukonStockStatus,
  ParsedJsonLdProduct,
  parseSitemapUrls,
  parseCurrentCategoryNames,
  parseChildCategoryLinks,
  parseCatalogProductUrls,
  parseCatalogCategoryUrls,
  parseCatalogPaginationUrls,
  parseBrandLinks,
  dukonPageKind,
  isCatalogUrl,
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
const DUKON_SITEMAP_URL = `${DUKON_BASE_URL}/sitemap-iblock-7.xml`;
const DUKON_CATALOG_ROOT_URLS = [`${DUKON_BASE_URL}/catalog/`];
/**
 * Pages between crawl-state checkpoints. The state is one JSON blob holding
 * visited listing URLs plus the queue; a pass at Dukon is ~10k pages, so
 * writing it on every fetch would mean hundreds of megabytes of writes a day.
 * Replaying a page is safe (`enqueueUrls` is idempotent), so a coarser
 * checkpoint only costs a few refetches after a crash. At 200 pages a pass
 * writes the ~1 MB state a few dozen times instead of a few hundred.
 */
const CRAWL_CHECKPOINT_PAGES = 200;

type DukonCrawlPage = CatalogCrawlEntry;
type DukonCrawlState = {
  visitedPages: string[];
  pageQueue: DukonCrawlPage[];
};
/** The first version of this state stored bare URL strings in the queue. */
type LegacyDukonCrawlState = {
  visitedPages?: string[];
  pageQueue?: Array<string | DukonCrawlPage>;
};

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
    if (sitemapError && !discovered.discoveredProducts) {
      throw sitemapError;
    }

    // The crawl keys off the shop's theme classes — `data-detail` cards for
    // products, `a.psection` / `.catmenu a` for the navigation — because
    // dukon's product and category URLs share one shape (`/catalog/<a>/<b>/`),
    // so unlike th-tool.by there is nothing in the URL itself to tell them
    // apart. A re-theme therefore looks like a crawl that walks pages and
    // extracts nothing; and because the sitemap leg keeps answering, the run
    // would record SUCCESS while the catalogue quietly stopped growing. That is
    // the silent parser death this project reports on everywhere else.
    // The brand index and the catalogue root are navigation only, hence
    // `productListingPages` rather than "no products anywhere".
    if (discovered.productListingPages > 0 && !discovered.discoveredProducts) {
      throw new Error(
        `Dukon catalog crawl walked ${discovered.visitedPages} pages and found no product links — the listing selectors no longer match the shop's markup`,
      );
    }

    return this.getQueueStats();
  }

  /**
   * One resumable pass over two product listings that Dukon exposes:
   *
   * - `/catalog/` — the category tree, 24 products per page;
   * - `/brands/` — 141 brand pages, 15 products per page. This is the complete
   *   per-brand enumeration and is what made a brand look "half missing":
   *   the catalogue crawl only reached the first pages of each branch before
   *   its page cap, so a brand with 200+ pages of products showed a handful.
   *
   * The pass is persisted in `ParserCatalogCrawl`, because the whole listing is
   * ~10k pages and `DUKON_DISCOVERY_MAX_PAGES` (5000) cannot hold a full pass.
   * Without state every daily run restarted at the same root and re-read the
   * same first 5000 pages; everything after them was never queued at all.
   * A drained queue clears the row, so the next run starts a fresh pass.
   */
  async discoverCatalogUrls() {
    const maxPages = await this.settings.getMaxPages(SOURCE_CODE);
    const delayMs = await this.settings.getRequestDelayMs(SOURCE_CODE);
    const source = await this.upsertSource();
    const saved = await this.loadCatalogCrawlState<LegacyDukonCrawlState>();
    const visitedPages = new Set<string>(saved?.visitedPages ?? []);
    // Brands first: a brand page is a complete product list for that brand,
    // while the catalogue repeats products across parent and leaf categories.
    const rawQueue = saved?.pageQueue ?? [];
    const pageQueue: DukonCrawlPage[] = rawQueue.length
      ? rawQueue.map((entry) =>
          typeof entry === 'string' ? { url: entry } : { ...entry },
        )
      : [
          { url: DUKON_BRANDS_URL },
          ...DUKON_CATALOG_ROOT_URLS.map((url) => ({ url })),
        ];
    const queuedPages = new Set([
      ...visitedPages,
      ...pageQueue.map((entry) => entry.url),
    ]);
    const productUrls = new Set<string>();
    // Pages that failed transiently in this run. They are kept out of the
    // live queue so they cannot block the pages discovered behind them, and
    // are put back for the next run; an entry is dropped after
    // MAX_CATALOG_PAGE_FAILURES attempts, so one permanently broken page
    // cannot stop every later pass.
    const deferredPages: DukonCrawlPage[] = [];
    let deferredCount = 0;
    let firstFailure: unknown;
    let productListingPages = 0;
    let fetchedPages = 0;
    let failedPages = 0;
    let exhaustedPages = 0;
    let consecutiveFailures = 0;
    let lastCheckpoint = 0;
    const save = () =>
      this.saveCatalogCrawlState<DukonCrawlState>({
        visitedPages: [...visitedPages],
        pageQueue: [...pageQueue, ...deferredPages],
      });
    const checkpoint = async () => {
      if (fetchedPages - lastCheckpoint >= CRAWL_CHECKPOINT_PAGES) {
        lastCheckpoint = fetchedPages;
        await save();
      }
    };

    // Persist the frontier before fetching: a crash must not lose the seed.
    await save();

    try {
      while (pageQueue.length && fetchedPages < maxPages) {
        const entry = pageQueue[0];
        if (!entry) {
          pageQueue.shift();
          continue;
        }
        if (visitedPages.has(entry.url)) {
          pageQueue.shift();
          continue;
        }

        let advanced = false;
        try {
          const html = await this.fetchText(entry.url);
          fetchedPages++;
          const $ = cheerio.load(html);
          const kind: DukonPageKind = dukonPageKind(entry.url);
          const pathname = new URL(entry.url).pathname;
          // A brand page and any catalogue page below the root must contain
          // product cards; the root and the brand index are navigation only.
          if (
            kind === 'brand' ||
            (kind === 'catalog' && pathname !== '/catalog/')
          ) {
            productListingPages++;
          }
          if (kind === 'catalog') {
            await this.saveDiscoveredCategories($, source.id, entry.url);
          }

          const pageProductUrls = parseCatalogProductUrls($);
          await this.enqueueUrls(pageProductUrls);
          pageProductUrls.forEach((url) => productUrls.add(url));

          const nextPages = new Set<string>(
            parseCatalogPaginationUrls($, entry.url),
          );
          if (kind === 'brand-index') {
            for (const brandUrl of parseBrandLinks($)) {
              nextPages.add(brandUrl);
            }
          }
          if (kind === 'catalog') {
            for (const categoryUrl of parseCatalogCategoryUrls(
              $,
              DUKON_CATALOG_ROOT_URLS[0],
            )) {
              nextPages.add(categoryUrl);
            }
          }

          // Advance only after the product URLs are saved. Replaying a page
          // after a crash is safe: enqueueUrls is idempotent.
          pageQueue.shift();
          visitedPages.add(entry.url);
          advanced = true;
          consecutiveFailures = 0;

          for (const nextPage of nextPages) {
            if (!visitedPages.has(nextPage) && !queuedPages.has(nextPage)) {
              queuedPages.add(nextPage);
              pageQueue.push({ url: nextPage });
            }
          }
        } catch (error) {
          // An error after the page was committed is a code/DB problem, not a
          // bad page: rethrow it without charging the entry another attempt.
          if (advanced) throw error;

          failedPages++;
          consecutiveFailures++;
          firstFailure ??= error;
          const gone =
            error instanceof ParserHttpError &&
            (error.status === 404 || error.status === 410);
          entry.failures = (entry.failures ?? 0) + 1;
          pageQueue.shift();

          if (gone || entry.failures >= MAX_CATALOG_PAGE_FAILURES) {
            // A removed category/brand is dropped at once; a page that keeps
            // failing is given up on rather than retried forever.
            visitedPages.add(entry.url);
            if (!gone) exhaustedPages++;
            this.logger.warn(
              `Dukon page dropped after ${entry.failures} failure(s): ${entry.url} — ${error instanceof Error ? error.message : String(error)}`,
            );
          } else {
            deferredPages.push(entry);
            deferredCount++;
          }

          // The entry is in the queue (or marked visited) before this throws,
          // so the finally-write below cannot lose it.
          if (consecutiveFailures >= MAX_CONSECUTIVE_CATALOG_FAILURES) {
            throw error;
          }
        }

        await checkpoint();
        await this.sleep(delayMs);
      }
    } finally {
      // Must land on every exit path: a thrown request keeps its queue entry
      // on disk, and a drained queue clears the row for a fresh pass.
      pageQueue.push(...deferredPages);
      deferredPages.length = 0;
      await save();
    }

    if (deferredCount || exhaustedPages) {
      // The pass went on past the failing pages, but the run still reports the
      // failure so health stops showing SUCCESS while discovery is degraded.
      const reason =
        firstFailure instanceof Error
          ? firstFailure.message
          : String(firstFailure);
      throw new Error(
        `Dukon catalog: ${deferredCount} page(s) failed and will be retried next run, ${exhaustedPages} dropped after ${MAX_CATALOG_PAGE_FAILURES} failures: ${reason}`,
        { cause: firstFailure },
      );
    }

    return {
      visitedPages: fetchedPages,
      discoveredProducts: productUrls.size,
      failedPages,
      deferredPages: deferredCount,
      exhaustedPages,
      productListingPages,
      remainingPages: pageQueue.length,
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
