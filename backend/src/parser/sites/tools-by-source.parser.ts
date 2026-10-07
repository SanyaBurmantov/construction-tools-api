import { FALLBACK_CATEGORY_SLUG } from '../../common/constants/catalog';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as cheerio from 'cheerio';
import { PrismaService } from '../../prisma/prisma.service';
import { generateSlug } from '../../common/utils/generate-slug';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { runWithConcurrency } from '../../common/utils/run-with-concurrency';
import { upsertTolerantly } from '../../common/utils/upsert-tolerantly';
import { ParserLogService } from '../parser-log.service';
import { ParserHttpError, isGoneError } from '../parser-http.error';
import {
  BatchOutcome,
  BatchResult,
  countOutcome,
  emptyBatchResult,
} from '../batch-result';
import { OffersService } from '../../offers/offers.service';
import { CategoryTreeService } from '../categories/category-tree.service';
import { ProductIdentityService } from '../product-identity.service';
import { ParserSettingsService } from '../parser-settings.service';
import { parseTools } from './tools.parser';

type SavedCategoryRef = { id: string; mappedCategoryId?: string | null };
type CatalogSnapshot = {
  data: {
    show_more_button?: boolean;
    loaded?: number;
    availableCategories?: unknown;
  };
  memo: { name: string };
};
type CatalogSession = { csrfToken: string; cookies: Map<string, string> };
type CatalogPage = { url: string; snapshot?: string; session?: CatalogSession };

type QueueStatus = 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'PROBLEM';

const SOURCE_CODE = 'tools-by';
const SOURCE_NAME = 'Tools.by';
const SOURCE_BASE_URL = 'https://tools.by';
/** Skipped, not failed: the page parsed fine, we just don't want the product. */
class SkippedToolsByProductError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkippedToolsByProductError';
  }
}

@Injectable()
export class ToolsByParserService {
  private readonly logger = new Logger(ToolsByParserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parserLogService: ParserLogService,
    private readonly offers: OffersService,
    private readonly categoryTree: CategoryTreeService,
    private readonly settings: ParserSettingsService,
    private readonly identity: ProductIdentityService,
  ) {}

  async refreshSitemaps() {
    await this.upsertSource();
    const result = await this.discoverCatalogUrls();
    return { ...(await this.getQueueStats()), ...result };
  }

  async discoverCatalogUrls() {
    const maxPages = await this.settings.getMaxPages(SOURCE_CODE);
    const delayMs = await this.settings.getRequestDelayMs(SOURCE_CODE);
    const visitedPages = new Set<string>();
    const queuedPages = new Set<string>([`${SOURCE_BASE_URL}/catalog`]);
    const pageQueue: CatalogPage[] = [{ url: `${SOURCE_BASE_URL}/catalog` }];
    const productUrls = new Set<string>();
    let fetchedPages = 0;

    while (pageQueue.length && fetchedPages < maxPages) {
      const entry = pageQueue.shift();
      if (!entry) continue;
      let html: string;
      let snapshot: string | undefined;
      let session: CatalogSession;
      if (entry.snapshot && entry.session) {
        const result = await this.loadMore(
          entry.url,
          entry.snapshot,
          entry.session,
        );
        html = result.html;
        snapshot = result.snapshot;
        session = entry.session;
      } else {
        if (visitedPages.has(entry.url)) continue;
        visitedPages.add(entry.url);
        const result = await this.fetchCatalogPage(entry.url);
        html = result.html;
        session = result.session;
        snapshot = this.catalogSnapshot(cheerio.load(html));
      }
      fetchedPages += 1;
      const $ = cheerio.load(html);
      const pageProductUrls = this.parseProductLinks($);
      pageProductUrls.forEach((url) => productUrls.add(url));
      await this.enqueueUrls(pageProductUrls);

      for (const catalogUrl of this.parseCatalogLinks($)) {
        if (!visitedPages.has(catalogUrl) && !queuedPages.has(catalogUrl)) {
          queuedPages.add(catalogUrl);
          pageQueue.push({ url: catalogUrl });
        }
      }
      if (snapshot && this.readSnapshot(snapshot)?.data.show_more_button) {
        // Round-robin: visit other categories before loading the next 25 items.
        const previousLoaded = entry.snapshot
          ? this.readSnapshot(entry.snapshot)?.data.loaded
          : undefined;
        const loaded = this.readSnapshot(snapshot)?.data.loaded;
        if (
          previousLoaded !== undefined &&
          loaded !== undefined &&
          loaded <= previousLoaded
        ) {
          throw new Error(
            `Tools.by loadMore did not advance the catalog: ${entry.url}`,
          );
        }
        pageQueue.push({ url: entry.url, snapshot, session });
      }
      await this.sleep(delayMs);
    }

    return {
      visitedPages: fetchedPages,
      maxPages,
      discoveredProducts: productUrls.size,
      remainingPages: pageQueue.length,
    };
  }

  async getQueueStats() {
    const [queued, visited, failed, skipped] = await Promise.all([
      this.prisma.sitemapsToolsBy.count({ where: { status: 'PENDING' } }),
      this.prisma.sitemapsToolsBy.count({ where: { status: 'DONE' } }),
      this.prisma.sitemapsToolsBy.count({ where: { status: 'FAILED' } }),
      this.prisma.sitemapsToolsBy.count({ where: { status: 'SKIPPED' } }),
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
    status?: QueueStatus;
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
      this.prisma.sitemapsToolsBy.findMany({
        where,
        orderBy: [{ status: 'asc' }, { url: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sitemapsToolsBy.count({ where }),
    ]);

    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async retrySitemap(id: string) {
    return this.prisma.sitemapsToolsBy.update({
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
    return this.prisma.sitemapsToolsBy.updateMany({
      where: { status: { in: ['FAILED', 'SKIPPED'] } },
      data: {
        isVisited: false,
        status: 'PENDING',
        lastError: null,
        visitedAt: null,
      },
    });
  }

  /**
   * Puts the whole queue back to PENDING so every product is read again.
   *
   * Needed after a parser fix that changed what gets saved — products lost to
   * the old slug-collision bug, for instance, only reappear on a re-read.
   * `attempts` is reset too: these rows get a clean slate, not the watchdog's
   * three-strikes budget from a previous life.
   */
  async revalidateAllSitemaps() {
    return this.prisma.sitemapsToolsBy.updateMany({
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

  async processSitemapsBatch(limit = 30, concurrency = 1) {
    const urls = await this.prisma.sitemapsToolsBy.findMany({
      where: { status: 'PENDING' },
      orderBy: [{ visitedAt: { sort: 'asc', nulls: 'first' } }, { url: 'asc' }],
      take: limit,
    });

    const delayMs = await this.settings.getRequestDelayMs(SOURCE_CODE);

    const batch: BatchResult = emptyBatchResult();

    await runWithConcurrency(urls, concurrency, async (entry) => {
      await this.sleep(delayMs);
      countOutcome(batch, await this.processSitemapUrl(entry.url));
    });

    return { ...(await this.getQueueStats()), batch };
  }

  async processSitemapUrl(url: string): Promise<BatchOutcome> {
    await this.prisma.sitemapsToolsBy.updateMany({
      where: { url },
      data: { attempts: { increment: 1 }, lastTriedAt: new Date() },
    });

    try {
      const product = await this.parseProductUrl(url);
      await this.prisma.sitemapsToolsBy.updateMany({
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
      // The supplier removed this product: withdraw the offer and re-price
      // whatever is left, instead of leaving a dead price on the storefront.
      if (isGoneError(error)) {
        const source = await this.upsertSource();
        await this.offers.delistOffer(source.id, this.canonicalUrl(url));
        await this.prisma.sitemapsToolsBy.updateMany({
          where: { url },
          data: {
            isVisited: true,
            status: 'SKIPPED',
            lastError: 'Removed by supplier (404)',
            visitedAt: new Date(),
          },
        });
        this.logger.log(`Delisted ${url}: gone from supplier`);
        return 'DELISTED';
      }

      // A filtered-out category is an expected outcome, not a failure — it must
      // not fill the error log or show up as a broken URL in the admin.
      const isSkipped = error instanceof SkippedToolsByProductError;
      if (!isSkipped) await this.parserLogService.addError(url, error);

      await this.prisma.sitemapsToolsBy.updateMany({
        where: { url },
        data: {
          isVisited: true,
          status: isSkipped ? 'SKIPPED' : 'FAILED',
          lastError: error instanceof Error ? error.message : String(error),
          visitedAt: new Date(),
        },
      });

      const message = error instanceof Error ? error.message : String(error);
      if (isSkipped) {
        this.logger.debug(`Skipped ${url}: ${message}`);
      } else {
        this.logger.warn(`Failed ${url}: ${message}`);
      }

      return isSkipped ? 'SKIPPED' : 'FAILED';
    }
  }

  async parseProductUrl(url: string) {
    const canonicalUrl = this.absoluteUrl(url);
    const parsed = parseTools(await this.fetchText(canonicalUrl));
    if (!parsed.name) throw new Error('Product name was not parsed');
    if (!parsed.isProductPage) {
      throw new SkippedToolsByProductError('URL is not a product page');
    }
    await this.ensureAllowedCategory(parsed.breadcrumbs);

    const source = await this.upsertSource();
    await this.ensureCategoryNotDisabled(source.id, parsed.breadcrumbs);
    const breadcrumbs = parsed.breadcrumbs;
    const { sourceCategoryId, categoryId } = await this.parseAndSaveCategories(
      source.id,
      breadcrumbs,
    );
    const sku = parsed.sku;
    const brandName = parsed.brand;
    const brandId = brandName
      ? await this.identity.upsertBrand(brandName)
      : undefined;
    const slug = this.productSlug(parsed.name, sku);
    // Status of the product THIS offer belongs to. Looking it up by slug
    // could republish an unrelated product that merely shares the name.
    const existingProductId = await this.identity.findByOffer(
      source.id,
      canonicalUrl,
    );
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
    const seoTitle = parsed.name;
    const seoDescription = parsed.description || parsed.name;
    const images = parsed.images.map((image, order) => ({
      url: image,
      alt: parsed.name,
      order,
    }));
    // Keep existing images if a (possibly flaky) re-parse returned none, so a
    // partial fetch never wipes a product's gallery.
    const imagesUpdate =
      images.length > 0 ? { images: { deleteMany: {}, create: images } } : {};

    // Identity is the supplier offer, not the slug — see
    // ProductIdentityService for why upserting on slug lost products.
    const product = await this.identity.save({
      sourceId: source.id,
      url: canonicalUrl,
      baseSlug: slug,
      data: {
        update: {
          ...statusUpdate,
          name: parsed.name,
          sku,
          barcode: parsed.barcode,
          model: parsed.model,
          brandId,
          categoryId,
          // priceValue is deliberately absent: PricingService owns the storefront
          // price so markup rules apply and MANUAL prices aren't clobbered.
          priceCurrency: 'BYN',
          stockStatus: this.stockStatus(parsed.inStock),
          descriptionShort: seoDescription,
          descriptionFull: parsed.description,
          seoTitle,
          seoDescription,
          ...imagesUpdate,
        },
        create: {
          name: parsed.name,
          slug,
          sku,
          barcode: parsed.barcode,
          model: parsed.model,
          brandId,
          categoryId,
          priceValue: parsed.price,
          priceCurrency: 'BYN',
          stockStatus: this.stockStatus(parsed.inStock),
          status: 'PUBLISHED',
          descriptionShort: seoDescription,
          descriptionFull: parsed.description,
          seoTitle,
          seoDescription,
          images: { create: images },
        },
      },
    });

    await this.saveSpecifications(
      parsed.specifications,
      product.id,
      categoryId,
    );
    await this.saveSourceProduct(canonicalUrl, product.id, source.id, {
      sourceCategoryId,
      name: parsed.name,
      sku,
      barcode: parsed.barcode,
      model: parsed.model,
      brandName,
      inStock: parsed.inStock,
      price: parsed.price,
      description: parsed.description,
      images: parsed.images,
      specifications: parsed.specifications,
      breadcrumbs,
      seoTitle,
      seoDescription,
    });

    // Offers are saved by now, so the price comes from the cheapest available
    // supplier rather than whichever parser happened to run last. Also refreshes
    // the dedup keys so a newly learned barcode makes the product matchable.
    await this.offers.onProductParsed(product.id);

    return product;
  }

  async previewProductUrl(url: string) {
    const canonicalUrl = this.canonicalUrl(url);
    const parsed = parseTools(await this.fetchText(canonicalUrl));
    if (!parsed.name) throw new Error('Product name was not parsed');

    return {
      source: SOURCE_CODE,
      url: canonicalUrl,
      isProductPage: parsed.isProductPage,
      allowedByCategoryFilter: await this.isAllowedCategory(parsed.breadcrumbs),
      name: parsed.name,
      sku: parsed.sku,
      barcode: parsed.barcode,
      model: parsed.model,
      brandName: parsed.brand,
      priceValue: parsed.price,
      priceCurrency: 'BYN',
      inStock: parsed.inStock,
      description: parsed.description,
      images: parsed.images,
      specifications: parsed.specifications,
      breadcrumbs: parsed.breadcrumbs,
      seoTitle: parsed.name,
      seoDescription: parsed.description || parsed.name,
    };
  }

  /* -------------------------------------------------------- filtering ---- */

  /** Filters come from /admin/parsing (DB), falling back to env then code. */
  private async isAllowedCategory(breadcrumbs: string[]) {
    const filters = await this.settings.getCategoryFilters(SOURCE_CODE);
    const haystack = breadcrumbs.join(' / ').toLowerCase();
    const include = this.optionalRegex(filters.include);
    const exclude = this.optionalRegex(filters.exclude);

    if (include && !include.test(haystack)) return false;
    if (exclude?.test(haystack)) return false;
    return true;
  }

  private optionalRegex(value?: string) {
    return value?.trim() ? new RegExp(value, 'i') : undefined;
  }

  private async ensureAllowedCategory(breadcrumbs: string[]) {
    if (!(await this.isAllowedCategory(breadcrumbs))) {
      throw new SkippedToolsByProductError(
        `Category is filtered out: ${breadcrumbs.join(' / ') || '(no breadcrumbs)'}`,
      );
    }
  }

  /**
   * Per-category switch from /admin/parsing. A parent being off disables its
   * children, hence the check against every prefix of the breadcrumb chain.
   */
  private async ensureCategoryNotDisabled(
    sourceId: string,
    breadcrumbs: string[],
  ) {
    const path: string[] = [];
    const externalIds: string[] = [];

    for (const name of breadcrumbs) {
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

    if (disabled) {
      throw new SkippedToolsByProductError(
        `Category is disabled in admin: ${disabled.name}`,
      );
    }
  }

  private stockStatus(inStock?: boolean) {
    if (inStock === undefined) return 'unknown';
    return inStock ? 'in_stock' : 'out_of_stock';
  }

  private async saveSourceProduct(
    url: string,
    productId: string,
    sourceId: string,
    data: {
      sourceCategoryId: string;
      name: string;
      sku?: string;
      barcode?: string;
      model?: string;
      brandName?: string;
      inStock?: boolean;
      price?: number;
      description?: string;
      images: string[];
      specifications: { name: string; value: string }[];
      breadcrumbs: string[];
      seoTitle?: string;
      seoDescription?: string;
    },
  ) {
    const attributes = Object.fromEntries(
      data.specifications.map((spec) => [spec.name, spec.value]),
    );
    const snapshot = this.toJson({
      attributes,
      source: {
        code: SOURCE_CODE,
        url,
        breadcrumbs: data.breadcrumbs,
        brandName: data.brandName,
        barcode: data.barcode,
        model: data.model,
        inStock: data.inStock ?? null,
        seoTitle: data.seoTitle,
        seoDescription: data.seoDescription,
        parsedAt: new Date().toISOString(),
      },
    });

    await upsertTolerantly(() =>
      this.prisma.sourceProduct.upsert({
        where: { sourceId_url: { sourceId, url } },
        update: {
          externalId: url,
          name: data.name,
          sku: data.sku,
          price: data.price,
          currency: 'BYN',
          stock: data.inStock ?? false,
          images: data.images,
          description: data.description,
          specifications: snapshot,
          productId,
          sourceCategoryId: data.sourceCategoryId,
          lastSync: new Date(),
        },
        create: {
          sourceId,
          externalId: url,
          url,
          name: data.name,
          sku: data.sku,
          price: data.price,
          currency: 'BYN',
          stock: data.inStock ?? false,
          images: data.images,
          description: data.description,
          specifications: snapshot,
          productId,
          sourceCategoryId: data.sourceCategoryId,
        },
      }),
    );
  }

  private async parseAndSaveCategories(
    sourceId: string,
    breadcrumbs: string[],
  ) {
    const names = breadcrumbs.filter(Boolean);
    // Canonical tree keyed on the full slug chain — see CategoryTreeService.

    let sourceParentId: string | null = null;
    const path: string[] = [];
    let sourceCategoryId = '';
    let mappedCategoryId: string | null = null;

    for (const name of names) {
      const slug = generateSlug(name);
      if (!slug) continue;

      path.push(slug);
      const externalId = path.join('/');
      const sourceCategory = (await upsertTolerantly(() =>
        this.prisma.sourceCategory.upsert({
          where: { sourceId_externalId: { sourceId, externalId } },
          update: {
            name,
            slug,
            parentId: sourceParentId,
            level: path.length - 1,
            path: [...path],
          },
          create: {
            sourceId,
            externalId,
            name,
            slug,
            parentId: sourceParentId,
            level: path.length - 1,
            path: [...path],
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

    const fallback = await this.getFallbackCategory(sourceId);
    return fallback;
  }

  private async getFallbackCategory(sourceId: string) {
    const sourceCategory = await upsertTolerantly(() =>
      this.prisma.sourceCategory.upsert({
        where: { sourceId_externalId: { sourceId, externalId: SOURCE_CODE } },
        update: {},
        create: {
          sourceId,
          externalId: SOURCE_CODE,
          name: SOURCE_NAME,
          slug: SOURCE_CODE,
          level: 0,
          path: [SOURCE_CODE],
        },
      }),
    );
    if (sourceCategory.mappedCategoryId) {
      return {
        sourceCategoryId: sourceCategory.id,
        categoryId: sourceCategory.mappedCategoryId,
      };
    }
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
    return {
      sourceCategoryId: sourceCategory.id,
      categoryId: sourceCategory.mappedCategoryId || category.id,
    };
  }

  private async saveSpecifications(
    specs: { name: string; value: string }[],
    productId: string,
    categoryId: string,
  ) {
    for (const spec of specs) {
      const key = generateSlug(spec.name);
      if (!key) continue;

      const specification = await this.identity.upsertSpecification(
        categoryId,
        spec.name,
        key,
        spec.value,
      );
      if (!specification) continue;

      await this.prisma.productSpecification.upsert({
        where: {
          productId_specificationId: {
            productId,
            specificationId: specification.id,
          },
        },
        update: { value: spec.value },
        create: {
          productId,
          specificationId: specification.id,
          value: spec.value,
        },
      });
    }
  }

  private upsertSource() {
    return this.prisma.source.upsert({
      where: { code: SOURCE_CODE },
      update: { name: SOURCE_NAME, url: SOURCE_BASE_URL },
      create: { name: SOURCE_NAME, code: SOURCE_CODE, url: SOURCE_BASE_URL },
    });
  }

  private parseBreadcrumbs($: cheerio.CheerioAPI) {
    return $('.breadcrumb [itemprop="item"]')
      .map((_, el) => {
        const href = $(el).attr('href') || '';
        if (!href.includes('/catalog/') || href.includes('brand_id')) return '';
        return this.clean($(el).find('[itemprop="name"]').text());
      })
      .get()
      .filter(Boolean);
  }

  private parseBrand($: cheerio.CheerioAPI) {
    return this.clean($('.brand a, .product__brand a').first().text());
  }

  private parseProductLinks($: cheerio.CheerioAPI) {
    const urls = new Set<string>();

    $('a[href*="/product/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) urls.add(this.canonicalUrl(this.absoluteUrl(href)));
    });

    return [...urls];
  }

  private parseCatalogLinks($: cheerio.CheerioAPI) {
    const urls = new Set<string>();
    // The catalog menu is lazy-loaded. Its top-level IDs are nevertheless
    // present in the filters snapshot, even on the /catalog -> novelties page.
    $('[wire\\:snapshot]').each((_, el) => {
      const raw = $(el).attr('wire:snapshot');
      const snapshot = raw ? this.readSnapshot(raw) : undefined;
      if (snapshot?.memo.name !== 'catalog.filters') return;
      const categories = snapshot.data.availableCategories;
      if (!Array.isArray(categories) || !categories[0]) return;
      for (const id of Object.keys(categories[0] as object)) {
        if (/^\d+$/.test(id)) urls.add(`${SOURCE_BASE_URL}/catalog/${id}`);
      }
    });
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      let url: URL;
      try {
        url = new URL(href, SOURCE_BASE_URL);
      } catch {
        return;
      }
      if (
        url.origin !== SOURCE_BASE_URL ||
        !/^\/catalog\/\d+(?:\/\d+)*\/?$/.test(url.pathname)
      )
        return;
      // Preserve only pagination; sorting and brand filters duplicate pages.
      const page = url.searchParams.get('page');
      url.search = '';
      url.hash = '';
      if (page && /^[1-9]\d*$/.test(page)) url.searchParams.set('page', page);
      urls.add(url.toString());
    });
    return [...urls];
  }

  private readSnapshot(raw: string): CatalogSnapshot | undefined {
    try {
      const snapshot = JSON.parse(raw) as CatalogSnapshot;
      return snapshot?.memo?.name && snapshot?.data ? snapshot : undefined;
    } catch {
      return undefined;
    }
  }

  private catalogSnapshot($: cheerio.CheerioAPI) {
    return $('[wire\\:snapshot]')
      .map((_, el) => $(el).attr('wire:snapshot'))
      .get()
      .find((raw) =>
        ['catalog.catalog', 'catalog.novelties'].includes(
          this.readSnapshot(raw)?.memo.name || '',
        ),
      );
  }

  private saveCookies(response: Response, session: CatalogSession) {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator > 0) session.cookies.set(pair.slice(0, separator), pair);
    }
  }

  private async fetchCatalogPage(url: string) {
    const response = await fetchWithTimeout(url, {
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    if (!response.ok) throw new ParserHttpError(response.status, url);
    const html = await response.text();
    const session: CatalogSession = {
      csrfToken:
        cheerio.load(html)('meta[name="csrf-token"]').attr('content') || '',
      cookies: new Map(),
    };
    this.saveCookies(response, session);
    return { html, session };
  }

  private async loadMore(
    url: string,
    snapshot: string,
    session: CatalogSession,
  ) {
    if (!session.csrfToken)
      throw new Error(`Tools.by catalog CSRF token missing: ${url}`);
    const endpoint = `${SOURCE_BASE_URL}/livewire/update`;
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0',
        'content-type': 'application/json',
        'x-livewire': '',
        referer: url,
        cookie: [...session.cookies.values()].join('; '),
      },
      body: JSON.stringify({
        _token: session.csrfToken,
        components: [
          {
            snapshot,
            updates: {},
            calls: [{ path: '', method: 'loadMore', params: [] }],
          },
        ],
      }),
    });
    if (!response.ok) throw new ParserHttpError(response.status, endpoint);
    this.saveCookies(response, session);
    const payload = (await response.json()) as {
      components?: Array<{
        snapshot?: string;
        effects?: {
          html?: string;
          dispatches?: Array<{ name?: string; params?: { htmlData?: string } }>;
        };
      }>;
    };
    const component = payload.components?.[0];
    if (!component?.snapshot || !component.effects?.html) {
      throw new Error(`Tools.by loadMore response has no catalog HTML: ${url}`);
    }
    // Product cards arrive in a dataRetrieved event, while effects.html only
    // contains the load-more button. Both are needed to discover the next batch.
    const productHtml = (component.effects.dispatches ?? [])
      .filter((event) => event.name === 'dataRetrieved')
      .map((event) => event.params?.htmlData ?? '')
      .join('');
    const html = component.effects.html + productHtml;
    if (
      this.readSnapshot(component.snapshot)?.data.show_more_button &&
      !this.parseProductLinks(cheerio.load(html)).length
    ) {
      throw new Error(
        `Tools.by loadMore response has no product links: ${url}`,
      );
    }
    return { snapshot: component.snapshot, html };
  }

  private async enqueueUrls(urls: string[]) {
    for (const url of [...new Set(urls)].filter((item) =>
      item.startsWith(`${SOURCE_BASE_URL}/product/`),
    )) {
      await this.prisma.sitemapsToolsBy.upsert({
        where: { url },
        update: {},
        create: { url, status: 'PENDING' },
      });
    }
  }

  private findSpecValue(
    specs: { name: string; value: string }[],
    needles: string[],
  ) {
    return specs.find((spec) =>
      needles.some((needle) => spec.name.toLowerCase().includes(needle)),
    )?.value;
  }

  private productSlug(name: string, sku?: string) {
    const base = generateSlug(name);
    const suffix = sku ? generateSlug(sku) : '';
    return suffix && !base.includes(suffix) ? `${base}-${suffix}` : base;
  }

  private parseMeta($: cheerio.CheerioAPI, name: string) {
    return this.clean(
      $(`meta[name="${name}"], meta[property="${name}"]`)
        .first()
        .attr('content') || '',
    );
  }

  private async fetchText(url: string) {
    const res = await fetchWithTimeout(url, {
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new ParserHttpError(res.status, url);
    return res.text();
  }

  private absoluteUrl(url: string) {
    if (url.startsWith('http')) return url;
    return `${SOURCE_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private canonicalUrl(url: string) {
    const parsed = new URL(this.absoluteUrl(url));
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private clean(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
