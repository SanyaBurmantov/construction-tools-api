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
import { PrismaService } from '../../prisma/prisma.service';
import { generateSlug } from '../../common/utils/generate-slug';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { upsertTolerantly } from '../../common/utils/upsert-tolerantly';
import { ParserLogService } from '../parser-log.service';
import { ParserHttpError } from '../parser-http.error';
import { OffersService } from '../../offers/offers.service';
import { CategoryTreeService } from '../categories/category-tree.service';
import { ProductIdentityService } from '../product-identity.service';
import { ParserSettingsService } from '../parser-settings.service';
import { parseTools } from './tools.parser';
import { offerPrice } from '../offer-price';

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
type CatalogPage = CatalogCrawlEntry & {
  snapshot?: string;
  session?: CatalogSession;
};
type SavedCatalogPage = Omit<CatalogPage, 'session'> & {
  session?: { csrfToken: string; cookies: [string, string][] };
};
type SavedCatalogCrawlState = {
  visitedPages: string[];
  pageQueue: SavedCatalogPage[];
};

const SOURCE_CODE = 'tools-by';
/**
 * Pages between crawl-state checkpoints.
 *
 * The state is one JSON blob holding every URL visited so far in the pass plus
 * the queue, and each queued paginating category carries its signed Livewire
 * snapshot — ~4 KB apiece. A pass across tools.by's 22 top-level departments
 * therefore grows a blob of a few MB, and it used to be re-serialised and
 * upserted after *every* page fetch, up to `maxPages` (2000) times per run —
 * gigabytes of writes per run, growing as the pass progressed.
 *
 * Checkpointing is only crash insurance, and replay is already safe:
 * `enqueueUrls` upserts idempotently. So the cost of a coarser interval is
 * re-fetching at most this many pages after a crash.
 */
const CRAWL_CHECKPOINT_PAGES = 25;

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
export class ToolsByParserService extends SupplierQueueParser {
  protected readonly logger = new Logger(ToolsByParserService.name);
  protected readonly supplier: SupplierInfo = {
    code: 'tools-by',
    name: SOURCE_NAME,
    baseUrl: SOURCE_BASE_URL,
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
    return error instanceof SkippedToolsByProductError;
  }

  async refreshSitemaps() {
    await this.upsertSource();
    const result = await this.discoverCatalogUrls();
    // An individual category can legitimately be empty, but a whole run that
    // fetched pages and extracted not one product URL means the markup moved
    // under us. Without this the run finishes, records SUCCESS, and the only
    // symptom is a catalogue that stops growing.
    if (result.visitedPages > 0 && !result.discoveredProducts) {
      throw new Error(
        `Tools.by catalog crawl walked ${result.visitedPages} pages and found no product links`,
      );
    }
    return { ...(await this.getQueueStats()), ...result };
  }

  async discoverCatalogUrls() {
    const maxPages = await this.settings.getMaxPages(SOURCE_CODE);
    const delayMs = await this.settings.getRequestDelayMs(SOURCE_CODE);
    const state = await this.loadCatalogCrawlState<SavedCatalogCrawlState>();
    const visitedPages = new Set<string>(state?.visitedPages ?? []);
    const pageQueue: CatalogPage[] = state
      ? state.pageQueue.map((entry) => ({
          ...entry,
          session: entry.session
            ? { ...entry.session, cookies: new Map(entry.session.cookies) }
            : undefined,
        }))
      : [{ url: `${SOURCE_BASE_URL}/catalog` }];
    const queuedPages = new Set<string>([
      ...visitedPages,
      ...pageQueue.map((entry) => entry.url),
    ]);
    // Persist before fetching; a failed request must retain its queue entry.
    await this.saveCatalogCrawl(visitedPages, pageQueue);
    const productUrls = new Set<string>();
    let fetchedPages = 0;
    const renewedSessions = new Set<string>();
    const checkpoint = async () => {
      if (fetchedPages % CRAWL_CHECKPOINT_PAGES === 0) {
        await this.saveCatalogCrawl(visitedPages, pageQueue);
      }
    };

    let consecutiveFailures = 0;
    // Entries that failed in this run went to the back of the queue; reaching
    // one again means everything left has been tried once — stop there rather
    // than hammer the same pages, and retry on the next run.
    const failedThisRun = new Set<CatalogPage>();
    let firstFailure: unknown;
    try {
      while (pageQueue.length && fetchedPages < maxPages) {
        const entry = pageQueue[0];
        if (!entry) continue;
        if (failedThisRun.has(entry)) break;
        let advanced = false;
        try {
          let html: string;
          let snapshot: string | undefined;
          let session: CatalogSession;
          if (entry.snapshot && entry.session) {
            let result: { html: string; snapshot: string };
            try {
              result = await this.loadMore(
                entry.url,
                entry.snapshot,
                entry.session,
              );
            } catch (error) {
              if (
                error instanceof ParserHttpError &&
                error.status === 419 &&
                !renewedSessions.has(entry.url)
              ) {
                // CSRF sessions can expire between daily runs. Keep the signed
                // pagination snapshot and get fresh cookies on the next request.
                entry.session = undefined;
                fetchedPages += 1;
                await checkpoint();
                await this.sleep(delayMs);
                continue;
              }
              throw error;
            }
            html = result.html;
            snapshot = result.snapshot;
            session = entry.session;
          } else {
            const result = await this.fetchCatalogPage(entry.url);
            if (entry.snapshot) {
              entry.session = result.session;
              renewedSessions.add(entry.url);
              fetchedPages += 1;
              await checkpoint();
              await this.sleep(delayMs);
              continue;
            }
            html = result.html;
            session = result.session;
            snapshot = this.catalogSnapshot(cheerio.load(html));
          }
          fetchedPages += 1;
          const $ = cheerio.load(html);
          const pageProductUrls = this.parseProductLinks($);
          pageProductUrls.forEach((url) => productUrls.add(url));
          await this.enqueueUrls(pageProductUrls);

          // Advance only after the product URLs are saved. Replaying a page after
          // a crash is safe: enqueueUrls uses idempotent upserts.
          pageQueue.shift();
          advanced = true;
          consecutiveFailures = 0;
          visitedPages.add(entry.url);
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
        } catch (error) {
          // One bad entry used to be thrown before `shift()`, saved back as
          // the head of the queue, and retried first on every later run — a
          // single removed category blocked the only discovery path tools.by
          // has, forever. Now the entry is retried at the back of the queue a
          // few times and then dropped; a 404/410 is dropped at once.
          if (advanced) throw error;
          consecutiveFailures++;
          firstFailure ??= error;
          const gone =
            error instanceof ParserHttpError &&
            (error.status === 404 || error.status === 410);
          entry.failures = (entry.failures ?? 0) + 1;
          pageQueue.shift();
          if (gone || entry.failures >= MAX_CATALOG_PAGE_FAILURES) {
            visitedPages.add(entry.url);
            this.logger.warn(
              `Catalog page dropped after ${entry.failures} failure(s): ${entry.url} — ${error instanceof Error ? error.message : String(error)}`,
            );
          } else {
            failedThisRun.add(entry);
            pageQueue.push(entry);
          }
          if (consecutiveFailures >= MAX_CONSECUTIVE_CATALOG_FAILURES)
            throw error;
        }
        await checkpoint();
        await this.sleep(delayMs);
      }
    } finally {
      // This write is the one that must land, on every exit path. A thrown
      // request has to leave its queue entry on disk — that is what makes the
      // pass resumable — and a drained queue has to clear the row so the next
      // run starts a fresh pass. A periodic checkpoint alone guarantees
      // neither, which is why the save used to sit inside the loop.
      await this.saveCatalogCrawl(visitedPages, pageQueue);
    }

    if (failedThisRun.size) {
      // The pass went on past the failing pages, but the run still reports
      // the failure so health shows it until the page recovers or is dropped.
      const reason =
        firstFailure instanceof Error
          ? firstFailure.message
          : String(firstFailure);
      throw new Error(
        `Tools.by catalog: ${failedThisRun.size} page(s) failed and will be retried next run: ${reason}`,
        { cause: firstFailure },
      );
    }

    return {
      visitedPages: fetchedPages,
      maxPages,
      discoveredProducts: productUrls.size,
      remainingPages: pageQueue.length,
    };
  }

  private saveCatalogCrawl(
    visitedPages: Set<string>,
    pageQueue: CatalogPage[],
  ) {
    return this.saveCatalogCrawlState<SavedCatalogCrawlState>({
      visitedPages: [...visitedPages],
      pageQueue: pageQueue.map((entry) => ({
        ...entry,
        session: entry.session
          ? {
              csrfToken: entry.session.csrfToken,
              cookies: [...entry.session.cookies],
            }
          : undefined,
      })),
    });
  }

  async parseProductUrl(url: string) {
    /**
     * The offer's identity, and it has to be the *canonical* URL.
     *
     * The queue is filled with `canonicalUrl()` output and `processSitemapUrl`
     * withdraws a 404'd offer under `canonicalUrl(url)` too — but this used to
     * save under `absoluteUrl(url)`, which keeps the query string. Any row
     * reaching here with one (an admin pasting a link with `?utm_…`, a legacy
     * queue row) was therefore stored under a key nothing else ever looks up:
     * the supplier could delete the product and the dead offer would keep its
     * price on the storefront, and the same page re-read without the query
     * became a second offer rather than an update. One spelling, used by
     * everything that touches the offer.
     */
    const offerUrl = this.canonicalUrl(url);
    const parsed = parseTools(await this.fetchText(offerUrl));
    // Order matters: a catalogue or landing page has no product name either, so
    // checking the name first classified it FAILED instead of SKIPPED — which
    // put it in the error log and, because the watchdog requeues FAILED rows,
    // had it refetched every retry window forever.
    if (!parsed.isProductPage) {
      throw new SkippedToolsByProductError('URL is not a product page');
    }
    if (!parsed.name) throw new Error('Product name was not parsed');
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
      url: offerUrl,
      baseSlug: slug,
      data: {
        update: {
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
          priceCurrency: 'BYN',
          stockStatus: this.stockStatus(parsed.inStock),
          descriptionShort: seoDescription,
          descriptionFull: parsed.description,
          seoTitle,
          seoDescription,
          images: { create: images },
        },
      },
    });

    await this.identity.saveSpecifications(
      parsed.specifications,
      product.id,
      categoryId,
    );
    await this.saveSourceProduct(offerUrl, product.id, source.id, {
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
          price: offerPrice(data.price, data.inStock === false),
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
          // Never listed on the storefront — see FALLBACK_CATEGORY_SLUG.
          isVisible: false,
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

  private fetchCatalogResponse(url: string, init: RequestInit) {
    const configured = Number(process.env.TOOLS_BY_CATALOG_FETCH_TIMEOUT_MS);
    const timeoutMs =
      Number.isFinite(configured) && configured > 0 ? configured : 60_000;
    return fetchWithTimeout(url, init, { timeoutMs });
  }

  private async fetchCatalogPage(url: string) {
    const response = await this.fetchCatalogResponse(url, {
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
    const response = await this.fetchCatalogResponse(endpoint, {
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

  private productSlug(name: string, sku?: string) {
    const base = generateSlug(name);
    const suffix = sku ? generateSlug(sku) : '';
    return suffix && !base.includes(suffix) ? `${base}-${suffix}` : base;
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

  protected canonicalUrl(url: string) {
    const parsed = new URL(this.absoluteUrl(url));
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }

  private clean(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }
}
