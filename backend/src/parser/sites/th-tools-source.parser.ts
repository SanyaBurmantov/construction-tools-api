import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FALLBACK_CATEGORY_SLUG } from '../../common/constants/catalog';
import { PrismaService } from '../../prisma/prisma.service';
import { generateSlug } from '../../common/utils/generate-slug';
import { runWithConcurrency } from '../../common/utils/run-with-concurrency';
import { upsertTolerantly } from '../../common/utils/upsert-tolerantly';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
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
import { parseThTools } from './th-tools.parser';

type QueueStatus = 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'PROBLEM';
type SavedCategoryRef = { id: string; mappedCategoryId?: string | null };

const SOURCE_CODE = 'th-tools';
const SOURCE_NAME = 'TH-Tools';
const SOURCE_BASE_URL = 'https://th-tool.by';

/**
 * Category chains we deliberately do not import. th-tool.by is a tool shop,
 * but it also carries car accessories, bike parts and toiletries — see
 * `TH_TOOLS_CATEGORY_EXCLUDE_REGEX` in the env files for the default.
 */
export { TH_TOOLS_DEFAULT_EXCLUDE_REGEX as DEFAULT_EXCLUDE_REGEX } from '../parser-defaults';

/**
 * Whole categories we do not want in the catalogue, matched against the
 * breadcrumb chain so a rule also catches subcategories ("Аксессуары /
 * Автолампы / Philips"). Pure, so the regexes are unit-tested — a typo here
 * would silently drop the whole catalogue.
 */
export function isAllowedThToolsCategory(
  breadcrumbs: string[],
  patterns: { include?: string; exclude?: string },
) {
  const haystack = breadcrumbs.join(' / ').toLowerCase();
  const include = optionalRegex(patterns.include);
  const exclude = optionalRegex(patterns.exclude);

  if (include && !include.test(haystack)) return false;
  if (exclude?.test(haystack)) return false;
  return true;
}

function optionalRegex(value?: string) {
  return value?.trim() ? new RegExp(value, 'i') : undefined;
}

/** Skipped, not failed: the page parsed fine, we just don't want the product. */
class SkippedThToolsProductError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkippedThToolsProductError';
  }
}

@Injectable()
export class ThToolsParserService {
  private readonly logger = new Logger(ThToolsParserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parserLogService: ParserLogService,
    private readonly offers: OffersService,
    private readonly categoryTree: CategoryTreeService,
    private readonly settings: ParserSettingsService,
    private readonly identity: ProductIdentityService,
  ) {}

  /* ----------------------------------------------------------- queue ---- */

  async getUnvisitedSitemaps(limit = 10) {
    return this.prisma.sitemapsThTools.findMany({
      where: { status: 'PENDING' },
      orderBy: [{ visitedAt: { sort: 'asc', nulls: 'first' } }, { url: 'asc' }],
      take: limit,
    });
  }

  async getQueueStats() {
    const [queued, visited, failed, skipped] = await Promise.all([
      this.prisma.sitemapsThTools.count({ where: { status: 'PENDING' } }),
      this.prisma.sitemapsThTools.count({ where: { status: 'DONE' } }),
      this.prisma.sitemapsThTools.count({ where: { status: 'FAILED' } }),
      this.prisma.sitemapsThTools.count({ where: { status: 'SKIPPED' } }),
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
      this.prisma.sitemapsThTools.findMany({
        where,
        orderBy: [{ status: 'asc' }, { url: 'asc' }],
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

  async retrySitemap(id: string) {
    return this.prisma.sitemapsThTools.update({
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
    return this.prisma.sitemapsThTools.updateMany({
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
    return this.prisma.sitemapsThTools.updateMany({
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
    await this.publishDraftProducts();

    const urls = await this.getUnvisitedSitemaps(limit);
    // Read once per batch, not per URL: an admin lowering the delay mid-batch
    // should not make the parser speed up against the supplier retroactively.
    const delayMs = await this.settings.getRequestDelayMs(SOURCE_CODE);

    const batch: BatchResult = emptyBatchResult();

    await runWithConcurrency(urls, concurrency, async (sitemap) => {
      await this.sleep(delayMs);
      countOutcome(batch, await this.processSitemapUrl(sitemap.url));
    });

    return { ...(await this.getQueueStats()), batch };
  }

  async publishDraftProducts() {
    return this.prisma.product.updateMany({
      where: {
        status: 'DRAFT',
        sourceProducts: { some: { source: { code: SOURCE_CODE } } },
      },
      data: { status: 'PUBLISHED' },
    });
  }

  async processSitemapUrl(url: string): Promise<BatchOutcome> {
    await this.prisma.sitemapsThTools.updateMany({
      where: { url },
      data: { attempts: { increment: 1 }, lastTriedAt: new Date() },
    });

    try {
      const product = await this.parseProductUrl(url);

      await this.prisma.sitemapsThTools.updateMany({
        where: { url },
        data: {
          isVisited: true,
          status: 'DONE',
          lastError: null,
          visitedAt: new Date(),
        },
      });

      this.logger.debug(`Saved product: ${product.name}`);
      return 'DONE';
    } catch (error) {
      // The supplier removed this product: withdraw the offer and re-price
      // whatever is left, instead of leaving a dead price on the storefront.
      if (isGoneError(error)) {
        const source = await this.upsertSource();
        await this.offers.delistOffer(source.id, this.canonicalUrl(url));
        await this.prisma.sitemapsThTools.updateMany({
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

      const isSkipped = error instanceof SkippedThToolsProductError;
      if (!isSkipped) {
        await this.parserLogService.addError(url, error);
      }

      await this.prisma.sitemapsThTools.updateMany({
        where: { url },
        data: {
          isVisited: true,
          status: isSkipped ? 'SKIPPED' : 'FAILED',
          lastError: error instanceof Error ? error.message : String(error),
          visitedAt: new Date(),
        },
      });

      if (isSkipped) {
        this.logger.debug(`Skipped ${url}: ${(error as Error).message}`);
      } else {
        this.logger.warn(
          `Failed ${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return isSkipped ? 'SKIPPED' : 'FAILED';
    }
  }

  /* --------------------------------------------------------- parsing ---- */

  async parseProductUrl(url: string) {
    const canonicalUrl = this.canonicalUrl(url);
    const parsed = parseThTools(await this.fetchText(canonicalUrl));

    if (!parsed.name) throw new Error('Product name was not parsed');
    if (!parsed.isProductPage) {
      throw new SkippedThToolsProductError('URL is not a product page');
    }
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

    const seoDescription = parsed.description || parsed.name;
    const imageRows = parsed.images.map((image, order) => ({
      url: image,
      alt: parsed.name,
      order,
    }));
    // Keep existing images if a (possibly flaky) re-parse returned none, so a
    // partial fetch never wipes a product's gallery.
    const imagesUpdate =
      imageRows.length > 0
        ? { images: { deleteMany: {}, create: imageRows } }
        : {};
    const stockStatus = this.stockStatus(parsed.inStock);

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
          sku: parsed.sku,
          barcode: parsed.barcode,
          model: parsed.model,
          brandId,
          categoryId,
          // priceValue is deliberately absent: PricingService owns the storefront
          // price so markup rules apply and MANUAL prices aren't clobbered.
          priceCurrency: 'BYN',
          stockStatus,
          descriptionFull: parsed.description,
          seoTitle: parsed.name,
          seoDescription,
          ...imagesUpdate,
        },
        create: {
          name: parsed.name,
          slug,
          sku: parsed.sku,
          barcode: parsed.barcode,
          model: parsed.model,
          brandId,
          categoryId,
          priceValue: parsed.price,
          priceCurrency: 'BYN',
          stockStatus,
          status: 'PUBLISHED',
          descriptionFull: parsed.description,
          seoTitle: parsed.name,
          seoDescription,
          images: { create: imageRows },
        },
      },
    });

    await this.identity.saveSpecifications(
      parsed.specifications,
      product.id,
      categoryId,
    );
    await this.saveSourceProduct(canonicalUrl, product.id, source.id, {
      sourceCategoryId,
      name: parsed.name,
      sku: parsed.sku,
      barcode: parsed.barcode,
      model: parsed.model,
      brandName: parsed.brand,
      price: parsed.price,
      description: parsed.description,
      images: parsed.images,
      specifications: parsed.specifications,
      breadcrumbs: parsed.breadcrumbs,
      inStock: parsed.inStock,
    });

    // Offers are saved by now, so the price comes from the cheapest available
    // supplier rather than whichever parser happened to run last. Also refreshes
    // the dedup keys so a newly learned barcode makes the product matchable.
    await this.offers.onProductParsed(product.id);

    return product;
  }

  async previewProductUrl(url: string) {
    const canonicalUrl = this.canonicalUrl(url);
    const parsed = parseThTools(await this.fetchText(canonicalUrl));
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
    };
  }

  /* -------------------------------------------------------- filtering ---- */

  /** Filters come from /admin/parsing (DB), falling back to env then code. */
  private async isAllowedCategory(breadcrumbs: string[]) {
    return isAllowedThToolsCategory(
      breadcrumbs,
      await this.settings.getCategoryFilters(SOURCE_CODE),
    );
  }

  private async ensureAllowedCategory(breadcrumbs: string[]) {
    if (!(await this.isAllowedCategory(breadcrumbs))) {
      throw new SkippedThToolsProductError(
        `Category is filtered out: ${breadcrumbs.join(' / ') || '(no breadcrumbs)'}`,
      );
    }
  }

  /** Slug-path prefixes of a breadcrumb chain: `a`, `a/b`, `a/b/c`. */
  private categoryExternalIds(breadcrumbs: string[]) {
    const path: string[] = [];
    const ids: string[] = [];

    for (const name of breadcrumbs) {
      const slug = generateSlug(name);
      if (!slug) continue;
      path.push(slug);
      ids.push(path.join('/'));
    }

    return ids;
  }

  /**
   * An admin can switch off a whole branch in `/admin/parsing`. The flag lives
   * on `SourceCategory`, and a parent being off disables its children — hence
   * the check against every prefix of the breadcrumb chain, not just the leaf.
   */
  private async ensureCategoryNotDisabled(
    sourceId: string,
    breadcrumbs: string[],
  ) {
    const externalIds = this.categoryExternalIds(breadcrumbs);
    if (!externalIds.length) return;

    const disabled = await this.prisma.sourceCategory.findFirst({
      where: { sourceId, externalId: { in: externalIds }, isEnabled: false },
      select: { name: true },
    });

    if (disabled) {
      throw new SkippedThToolsProductError(
        `Category is disabled in admin: ${disabled.name}`,
      );
    }
  }

  /* ------------------------------------------------------- persistence ---- */

  private async upsertSource() {
    return this.prisma.source.upsert({
      where: { code: SOURCE_CODE },
      update: { name: SOURCE_NAME, url: SOURCE_BASE_URL },
      create: { name: SOURCE_NAME, code: SOURCE_CODE, url: SOURCE_BASE_URL },
    });
  }

  /**
   * Supplier categories are mirrored into `SourceCategory` keyed by their full
   * path, so the same leaf name under two different parents stays two rows and
   * an admin can remap either onto a canonical `Category`.
   */
  private async parseAndSaveCategories(
    sourceId: string,
    breadcrumbs: string[],
  ) {
    // The canonical tree is built by CategoryTreeService, which keys on the
    // full slug chain. Doing it here by leaf slug merged unrelated branches.

    let sourceParentId: string | null = null;
    const path: string[] = [];
    let sourceCategoryId = '';
    let mappedCategoryId: string | null = null;

    for (const name of breadcrumbs) {
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
      mappedCategoryId || !breadcrumbs.length
        ? null
        : await this.categoryTree.upsertBranch(breadcrumbs);
    if (sourceCategoryId && (mappedCategoryId || leafCategory)) {
      return {
        sourceCategoryId,
        categoryId: mappedCategoryId || leafCategory!.id,
      };
    }

    return this.getFallbackCategory();
  }

  private async getFallbackCategory() {
    const source = await this.upsertSource();
    const sourceCategory = await upsertTolerantly(() =>
      this.prisma.sourceCategory.upsert({
        where: {
          sourceId_externalId: { sourceId: source.id, externalId: SOURCE_CODE },
        },
        update: {},
        create: {
          sourceId: source.id,
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
      price?: number;
      description?: string;
      images: string[];
      specifications: { name: string; value: string }[];
      breadcrumbs: string[];
      inStock?: boolean;
    },
  ) {
    // SourceProduct has no columns for brand/barcode/breadcrumbs — they ride
    // along in the `specifications` snapshot, same as the 7745 parser.
    const snapshot = this.toJson({
      attributes: Object.fromEntries(
        data.specifications.map((spec) => [spec.name, spec.value]),
      ),
      source: {
        code: SOURCE_CODE,
        url,
        breadcrumbs: data.breadcrumbs,
        brandName: data.brandName,
        barcode: data.barcode,
        model: data.model,
        inStock: data.inStock ?? null,
        parsedAt: new Date().toISOString(),
      },
    });

    const payload = {
      externalId: url,
      sourceCategoryId: data.sourceCategoryId,
      name: data.name,
      sku: data.sku,
      price: data.price,
      currency: 'BYN',
      // Availability now comes from the page instead of a hardcoded `true`,
      // so "in stock beats a cheaper unavailable offer" has real input.
      stock: data.inStock ?? false,
      images: data.images,
      description: data.description,
      specifications: snapshot,
      productId,
    };

    await upsertTolerantly(() =>
      this.prisma.sourceProduct.upsert({
        where: { sourceId_url: { sourceId, url } },
        update: { ...payload, lastSync: new Date() },
        create: { ...payload, sourceId, url },
      }),
    );
  }

  /* ------------------------------------------------------------ utils ---- */

  private stockStatus(inStock?: boolean) {
    if (inStock === undefined) return 'unknown';
    return inStock ? 'in_stock' : 'out_of_stock';
  }

  private productSlug(name: string, sku?: string) {
    const base = generateSlug(name);
    const suffix = sku ? generateSlug(sku) : '';
    return suffix && !base.includes(suffix) ? `${base}-${suffix}` : base;
  }

  private async fetchText(url: string) {
    const res = await fetchWithTimeout(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
        referer: SOURCE_BASE_URL,
      },
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
    parsed.hash = '';
    return parsed.toString();
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
