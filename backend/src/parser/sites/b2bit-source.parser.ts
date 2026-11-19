import { Injectable, Logger } from '@nestjs/common';
import { FALLBACK_CATEGORY_SLUG } from '../../common/constants/catalog';
import { generateSlug } from '../../common/utils/generate-slug';
import { upsertTolerantly } from '../../common/utils/upsert-tolerantly';
import { OffersService } from '../../offers/offers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoryTreeService } from '../categories/category-tree.service';
import { SupplierConnectionService } from '../connection/supplier-connection.service';
import { ParserHttpError } from '../parser-http.error';
import { ParserLogService } from '../parser-log.service';
import { ParserSettingsService } from '../parser-settings.service';
import { ProductIdentityService } from '../product-identity.service';
import {
  MAX_CONSECUTIVE_CATALOG_FAILURES,
  SupplierInfo,
  SupplierQueueParser,
} from '../supplier-queue-parser';
import {
  B2BIT_API_URL,
  B2BIT_BASE_URL,
  B2bitCategoryNode,
  B2bitLeaf,
  B2bitListing,
  B2bitProduct,
  ParsedB2bitProduct,
  b2bitCatalogBranch,
  b2bitCategoryPaths,
  b2bitLeafCategories,
  b2bitListingIds,
  b2bitListingUrl,
  b2bitProductId,
  b2bitProductUrl,
  parseB2bitProduct,
  withCurrentPrice,
} from './b2bit.parse';

type SavedCategoryRef = { id: string; mappedCategoryId?: string | null };
type Session = { token: string; partnerId: number };
type LoginAnswer = {
  token?: string;
  data?: { partners?: Array<{ id?: number; name?: string }> };
};
type CategoryTree = {
  paths: Map<number, string[]>;
  leaves: B2bitLeaf[];
  loadedAt: number;
};

const SOURCE_CODE = 'b2bit';
const SOURCE_NAME = 'B2BIT (b2bit.by)';
/** The API's maximum is not documented; 100 is what the portal's table offers. */
const LISTING_PAGE_SIZE = 100;
/** The tree changes rarely; re-read it daily at discovery and on a miss. */
const TREE_TTL_MS = 6 * 3_600_000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** Skipped, not failed: the answer was fine, we just don't want the product. */
class SkippedB2bitProductError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkippedB2bitProductError';
  }
}

/**
 * b2bit.by — the B2B portal of «АйТи Дистрибуция», where the owner's company
 * «МультиТул» is a dealer. Everything is read from its JSON API under the
 * dealer account (`B2BIT_LOGIN` / `B2BIT_PASSWORD`, `.env.prod` only — the
 * repo is public). The pure half is `b2bit.parse.ts`; read its note for what
 * the API's fields really mean, the price above all.
 *
 * - **Discovery** is the category listings: the tree (`/categories`), then
 *   every leaf the include filter lets through (default: «Стройка и ремонт»),
 *   page by page, only products with a live offer. ~150 requests.
 * - **A product** is `/product/<id>`; the queue and the offer are keyed by
 *   the portal page `https://b2bit.by/product/<id>` (admin-only, like every
 *   supplier URL).
 * - **Auth**: `POST /auth/login` gives a token, sent as
 *   `Authorization: token <token> <partnerId>`. It is kept in memory and
 *   renewed on a 401; each process logs in on its own.
 */
@Injectable()
export class B2bitParserService extends SupplierQueueParser {
  protected readonly logger = new Logger(B2bitParserService.name);
  protected readonly supplier: SupplierInfo = {
    code: SOURCE_CODE,
    name: SOURCE_NAME,
    baseUrl: B2BIT_BASE_URL,
  };

  private session?: Promise<Session>;
  private tree?: CategoryTree;

  constructor(
    prisma: PrismaService,
    parserLogService: ParserLogService,
    offers: OffersService,
    categoryTree: CategoryTreeService,
    settings: ParserSettingsService,
    identity: ProductIdentityService,
    connection: SupplierConnectionService,
  ) {
    super(
      prisma,
      parserLogService,
      offers,
      categoryTree,
      settings,
      identity,
      connection,
    );
  }

  protected isSkippedError(error: unknown) {
    return error instanceof SkippedB2bitProductError;
  }

  /** No login, no batch: fail the run before any row is claimed. */
  protected beforeBatch() {
    return this.login();
  }

  /* ---------------------------------------------------------- discovery ---- */

  async refreshSitemaps() {
    await this.upsertSource();
    const result = await this.discoverCatalogUrls();
    // A run that read listings and found nothing means the API changed under
    // us; without this it would finish as SUCCESS and the catalogue would just
    // stop growing.
    if (result.visitedPages > 0 && !result.discoveredProducts) {
      throw new Error(
        `b2bit: прочитано ${result.visitedPages} страниц каталога, товаров не найдено`,
      );
    }
    return { ...(await this.getQueueStats()), ...result };
  }

  async discoverCatalogUrls() {
    const maxPages = await this.settings.getMaxPages(SOURCE_CODE);
    const delayMs = await this.settings.getRequestDelayMs(SOURCE_CODE);
    const tree = await this.categoryTreeOf(true);

    const leaves: B2bitLeaf[] = [];
    for (const leaf of tree.leaves) {
      if (leaf.count > 0 && (await this.isAllowedCategory(leaf.path))) {
        leaves.push(leaf);
      }
    }

    const found = new Set<number>();
    const failed: string[] = [];
    let firstFailure: unknown;
    let consecutiveFailures = 0;
    let visitedPages = 0;

    for (const leaf of leaves) {
      if (visitedPages >= maxPages) break;
      try {
        for (let page = 1; visitedPages < maxPages; page++) {
          await this.sleep(delayMs);
          const listing = await this.apiGet<B2bitListing>(
            b2bitListingUrl(leaf.id, page, LISTING_PAGE_SIZE),
          );
          visitedPages++;
          const ids = b2bitListingIds(listing);
          ids.forEach((id) => found.add(id));
          await this.enqueueUrls(ids.map((id) => b2bitProductUrl(id)));
          const total = listing.count ?? 0;
          if (!ids.length || page * LISTING_PAGE_SIZE >= total) break;
        }
        consecutiveFailures = 0;
      } catch (error) {
        // One category failing (the API answers 500 now and then) does not
        // cost the others; the next daily run reads it again.
        failed.push(leaf.path.join(' / '));
        firstFailure ??= error;
        this.logger.warn(
          `b2bit category ${leaf.id} (${leaf.path.join(' / ')}) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (++consecutiveFailures >= MAX_CONSECUTIVE_CATALOG_FAILURES) {
          throw error;
        }
      }
    }

    if (failed.length) {
      const reason =
        firstFailure instanceof Error
          ? firstFailure.message
          : String(firstFailure);
      throw new Error(
        `b2bit: ${failed.length} категорий не прочитано, повтор в следующий запуск (найдено товаров ${found.size}): ${reason}`,
        { cause: firstFailure },
      );
    }

    return {
      categories: leaves.length,
      visitedPages,
      maxPages,
      discoveredProducts: found.size,
    };
  }

  private async enqueueUrls(urls: string[]) {
    for (const url of new Set(urls)) {
      await this.prisma.sitemapsB2bit.upsert({
        where: { url },
        update: {},
        create: { url, status: 'PENDING' },
      });
    }
  }

  /* ------------------------------------------------------------ product ---- */

  async parseProductUrl(url: string) {
    const parsed = await this.fetchProduct(url);
    const offerUrl = b2bitProductUrl(parsed.productId);
    if (!parsed.name) throw new Error('Product name was not parsed');
    await this.ensureAllowedCategory(parsed.breadcrumbs);

    const source = await this.upsertSource();
    await this.ensureCategoryNotDisabled(source.id, parsed.breadcrumbs);
    const { sourceCategoryId, categoryId } = await this.parseAndSaveCategories(
      source.id,
      parsed.breadcrumbs,
    );
    const brandId = parsed.brand
      ? await this.identity.upsertBrand(parsed.brand)
      : undefined;
    const slug = this.productSlug(parsed.name, parsed.sku);
    const images = parsed.images.map((image, order) => ({
      url: image,
      sourceUrl: image,
      alt: parsed.name,
      order,
    }));
    // A re-read that came back without photos keeps the gallery it had.
    const imagesUpdate =
      images.length > 0 ? { images: { deleteMany: {}, create: images } } : {};
    const stockStatus = parsed.inStock ? 'in_stock' : 'out_of_stock';

    // No description fields: b2bit has none (its «description» is the spec
    // values joined by slashes), and leaving them out keeps a text another
    // supplier or an AI task wrote.
    const product = await this.identity.save({
      sourceId: source.id,
      url: offerUrl,
      baseSlug: slug,
      data: {
        update: {
          name: parsed.name,
          sku: parsed.sku,
          barcode: parsed.barcode,
          brandId,
          categoryId,
          // priceValue is deliberately absent: PricingService owns it.
          priceCurrency: 'BYN',
          stockStatus,
          seoTitle: parsed.name,
          seoDescription: parsed.name,
          ...imagesUpdate,
        },
        create: {
          name: parsed.name,
          slug,
          sku: parsed.sku,
          barcode: parsed.barcode,
          brandId,
          categoryId,
          priceCurrency: 'BYN',
          stockStatus,
          seoTitle: parsed.name,
          seoDescription: parsed.name,
          images: { create: images },
        },
      },
    });

    await this.identity.saveSpecifications(
      parsed.specifications,
      product.id,
      categoryId,
    );
    await this.saveSourceProduct(
      offerUrl,
      product.id,
      source.id,
      sourceCategoryId,
      parsed,
    );
    // Offers are saved: the card's price comes from the cheapest live offer.
    await this.offers.onProductParsed(product.id);

    return product;
  }

  /** The admin's dry run: the same reading, nothing written. */
  async previewProductUrl(url: string) {
    const parsed = await this.fetchProduct(url);
    if (!parsed.name) throw new Error('Product name was not parsed');
    return {
      source: SOURCE_CODE,
      url: b2bitProductUrl(parsed.productId),
      allowedByCategoryFilter: await this.isAllowedCategory(parsed.breadcrumbs),
      name: parsed.name,
      sku: parsed.sku,
      barcode: parsed.barcode,
      brandName: parsed.brand,
      priceValue: parsed.price,
      priceCurrency: 'BYN',
      inStock: parsed.inStock,
      hasOffer: parsed.hasOffer,
      // Admin-only reference numbers (this endpoint is behind AdminGuard).
      purchasePrice: parsed.purchasePrice,
      rrp: parsed.rrp,
      quantity: parsed.quantity,
      promotion: parsed.promotion,
      images: parsed.images,
      specifications: parsed.specifications,
      breadcrumbs: parsed.breadcrumbs,
      catalogBranch: b2bitCatalogBranch(parsed.breadcrumbs),
    };
  }

  private async fetchProduct(url: string): Promise<ParsedB2bitProduct> {
    const id = b2bitProductId(url);
    if (!id) throw new SkippedB2bitProductError('Not a b2bit product URL');
    const product = await this.apiGet<B2bitProduct>(
      `${B2BIT_API_URL}/product/${id}`,
    );
    let parsed = parseB2bitProduct(
      product,
      (await this.categoryTreeOf()).paths,
    );
    if (!parsed.breadcrumbs.length && parsed.categoryId !== undefined) {
      // A category added since the tree was read.
      parsed = parseB2bitProduct(
        product,
        (await this.categoryTreeOf(true)).paths,
      );
    }
    return parsed;
  }

  /* ---------------------------------------------------------------- API ---- */

  private async categoryTreeOf(force = false): Promise<CategoryTree> {
    if (!force && this.tree && Date.now() - this.tree.loadedAt < TREE_TTL_MS) {
      return this.tree;
    }
    const nodes = await this.apiGet<B2bitCategoryNode[]>(
      `${B2BIT_API_URL}/categories`,
    );
    if (!Array.isArray(nodes) || !nodes.length) {
      throw new Error('b2bit: пустое дерево категорий');
    }
    this.tree = {
      paths: b2bitCategoryPaths(nodes),
      leaves: b2bitLeafCategories(nodes),
      loadedAt: Date.now(),
    };
    return this.tree;
  }

  /** GET under the dealer session; a 401 means the token expired — once more. */
  private async apiGet<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const session = await this.login();
      const response = await this.fetchSupplier(url, {
        headers: {
          accept: 'application/json',
          'user-agent': USER_AGENT,
          'x-language': 'ru',
          authorization: `token ${session.token} ${session.partnerId}`,
        },
      });
      if (response.status === 401 && attempt === 0) {
        this.session = undefined;
        continue;
      }
      if (!response.ok) throw new ParserHttpError(response.status, url);
      return (await response.json()) as T;
    }
  }

  /** One login per process until the token is refused. */
  private login(): Promise<Session> {
    this.session ??= this.requestSession().catch((error: unknown) => {
      this.session = undefined;
      throw error;
    });
    return this.session;
  }

  private async requestSession(): Promise<Session> {
    // Read at call time, not at module load: a new password in .env.prod
    // must not wait for a code change.
    const username = process.env.B2BIT_LOGIN?.trim();
    const password = process.env.B2BIT_PASSWORD;
    if (!username || !password) {
      throw new Error(
        'b2bit: не задан вход — B2BIT_LOGIN и B2BIT_PASSWORD в .env.prod',
      );
    }
    const url = `${B2BIT_API_URL}/auth/login`;
    const response = await this.fetchSupplier(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      throw new Error(
        `b2bit: вход не удался (HTTP ${response.status}) — проверьте B2BIT_LOGIN и B2BIT_PASSWORD`,
      );
    }
    const answer = (await response.json()) as LoginAnswer;
    const partnerId = answer.data?.partners?.[0]?.id;
    if (!answer.token || !partnerId) {
      throw new Error('b2bit: вход без токена или без организации-партнёра');
    }
    return { token: answer.token, partnerId };
  }

  /* ---------------------------------------------------------- filtering ---- */

  /** Filters come from /admin/parsing (DB), falling back to env then code. */
  private async isAllowedCategory(breadcrumbs: string[]) {
    const filters = await this.settings.getCategoryFilters(SOURCE_CODE);
    const haystack = breadcrumbs.join(' / ');
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
      throw new SkippedB2bitProductError(
        `Category is filtered out: ${breadcrumbs.join(' / ') || '(no category)'}`,
      );
    }
  }

  /** The per-category switch of /admin/parsing; a parent off = its children. */
  private async ensureCategoryNotDisabled(
    sourceId: string,
    breadcrumbs: string[],
  ) {
    const externalIds = this.sourceCategoryKeys(breadcrumbs);
    if (!externalIds.length) return;
    const disabled = await this.prisma.sourceCategory.findFirst({
      where: { sourceId, externalId: { in: externalIds }, isEnabled: false },
      select: { name: true },
    });
    if (disabled) {
      throw new SkippedB2bitProductError(
        `Category is disabled in admin: ${disabled.name}`,
      );
    }
  }

  private sourceCategoryKeys(breadcrumbs: string[]) {
    const path: string[] = [];
    const keys: string[] = [];
    for (const name of breadcrumbs) {
      const slug = generateSlug(name);
      if (!slug) continue;
      path.push(slug);
      keys.push(path.join('/'));
    }
    return keys;
  }

  /* -------------------------------------------------------------- saving ---- */

  /**
   * The supplier-side chain keeps the b2bit department; our tree starts below
   * it (`b2bitCatalogBranch`), so «Электроинструмент» lands in our own
   * «Электроинструмент» root.
   */
  private async parseAndSaveCategories(
    sourceId: string,
    breadcrumbs: string[],
  ) {
    const names = breadcrumbs.filter(Boolean);
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
        : await this.categoryTree.upsertBranch(b2bitCatalogBranch(names));
    if (sourceCategoryId && (mappedCategoryId || leafCategory)) {
      return {
        sourceCategoryId,
        categoryId: mappedCategoryId || leafCategory!.id,
      };
    }
    return this.getFallbackCategory(sourceId);
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
    return { sourceCategoryId: sourceCategory.id, categoryId: category.id };
  }

  /**
   * The offer row. `price` is our selling price (the RRP; without one, the
   * higher of the struck-through price and the offer's current price — see
   * `withCurrentPrice`); the dealer price, RRP, quantity and promotion go into
   * the admin-only snapshot.
   * The API is JSON, not a selector that can silently stop matching, so a
   * missing price is believed: no RRP, struck-through or current price, or no
   * offer at all → `null`, the offer stops pricing the card.
   */
  private async saveSourceProduct(
    url: string,
    productId: string,
    sourceId: string,
    sourceCategoryId: string,
    parsed: ParsedB2bitProduct,
  ) {
    const snapshot = this.toJson({
      attributes: Object.fromEntries(
        parsed.specifications.map((spec) => [spec.name, spec.value]),
      ),
      source: {
        code: SOURCE_CODE,
        url,
        productId: parsed.productId,
        categoryId: parsed.categoryId ?? null,
        breadcrumbs: parsed.breadcrumbs,
        brandName: parsed.brand,
        barcode: parsed.barcode,
        inStock: parsed.inStock,
        hasOffer: parsed.hasOffer,
        purchasePrice: parsed.purchasePrice ?? null,
        rrp: parsed.rrp ?? null,
        quantity: parsed.quantity ?? null,
        promotion: parsed.promotion ?? null,
        supplierCode: parsed.supplierCode ?? null,
        warrantyMonths: parsed.warrantyMonths ?? null,
        parsedAt: new Date().toISOString(),
      },
    });
    const current = await this.prisma.sourceProduct.findUnique({
      where: { sourceId_url: { sourceId, url } },
      select: { price: true },
    });
    const price = withCurrentPrice(parsed, current?.price) ?? null;

    await upsertTolerantly(() =>
      this.prisma.sourceProduct.upsert({
        where: { sourceId_url: { sourceId, url } },
        update: {
          externalId: url,
          name: parsed.name,
          sku: parsed.sku,
          price,
          currency: 'BYN',
          stock: parsed.inStock,
          images: parsed.images,
          specifications: snapshot,
          productId,
          sourceCategoryId,
          lastSync: new Date(),
        },
        create: {
          sourceId,
          externalId: url,
          url,
          name: parsed.name,
          sku: parsed.sku,
          price,
          currency: 'BYN',
          stock: parsed.inStock,
          images: parsed.images,
          specifications: snapshot,
          productId,
          sourceCategoryId,
        },
      }),
    );
  }

  private productSlug(name: string, sku?: string) {
    const base = generateSlug(name);
    const suffix = sku ? generateSlug(sku) : '';
    return suffix && !base.includes(suffix) ? `${base}-${suffix}` : base;
  }

  protected canonicalUrl(url: string) {
    const id = b2bitProductId(url);
    if (id) return b2bitProductUrl(id);
    const parsed = new URL(url, B2BIT_BASE_URL);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }
}
