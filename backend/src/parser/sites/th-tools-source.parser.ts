import { Injectable, Logger } from '@nestjs/common';
import { FALLBACK_CATEGORY_SLUG } from '../../common/constants/catalog';
import { SupplierInfo, SupplierQueueParser } from '../supplier-queue-parser';
import { PrismaService } from '../../prisma/prisma.service';
import { generateSlug } from '../../common/utils/generate-slug';
import { upsertTolerantly } from '../../common/utils/upsert-tolerantly';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { ParserLogService } from '../parser-log.service';
import { ParserHttpError } from '../parser-http.error';
import { OffersService } from '../../offers/offers.service';
import { CategoryTreeService } from '../categories/category-tree.service';
import { ProductIdentityService } from '../product-identity.service';
import { ParserSettingsService } from '../parser-settings.service';
import { parseThTools } from './th-tools.parser';
import { PLACEHOLDER_IMAGE_MARKERS } from '../../common/utils/product-images';

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
export class ThToolsParserService extends SupplierQueueParser {
  protected readonly logger = new Logger(ThToolsParserService.name);
  protected readonly supplier: SupplierInfo = {
    code: 'th-tools',
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
    return error instanceof SkippedThToolsProductError;
  }

  /* ----------------------------------------------------------- queue ---- */

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

    const seoDescription = parsed.description || parsed.name;
    const imageRows = parsed.images.map((image, order) => ({
      url: image,
      alt: parsed.name,
      order,
    }));
    // Keep existing images if a (possibly flaky) re-parse returned none, so a
    // partial fetch never wipes a product's gallery — with one exception. A
    // product whose gallery holds only the theme's placeholder parses to zero
    // images, so "keep what we have" preserved that placeholder forever: ~12%
    // of the catalogue was still showing th-tool.by's grey "нет фото" PNG as
    // its product photo, and the "без фото" report could not see them either.
    // Those rows are dropped so the storefront falls back to our own
    // placeholder; a real photo is still never removed by an empty parse.
    const imagesUpdate =
      imageRows.length > 0
        ? { images: { deleteMany: {}, create: imageRows } }
        : {
            images: {
              deleteMany: {
                OR: PLACEHOLDER_IMAGE_MARKERS.map((marker) => ({
                  url: { contains: marker, mode: 'insensitive' as const },
                })),
              },
            },
          };
    const stockStatus = this.stockStatus(parsed.inStock);

    // Identity is the supplier offer, not the slug — see
    // ProductIdentityService for why upserting on slug lost products.
    const product = await this.identity.save({
      sourceId: source.id,
      url: canonicalUrl,
      baseSlug: slug,
      data: {
        update: {
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
          priceCurrency: 'BYN',
          stockStatus,
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

  protected canonicalUrl(url: string) {
    const parsed = new URL(this.absoluteUrl(url));
    parsed.hash = '';
    return parsed.toString();
  }
}
