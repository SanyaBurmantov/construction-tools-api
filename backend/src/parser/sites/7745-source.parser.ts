import { FALLBACK_CATEGORY_SLUG } from '../../common/constants/catalog';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
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
import { parse7745 } from './7745.parser';

type SavedCategoryRef = { id: string; mappedCategoryId?: string | null };

const SOURCE_CODE = '7745';
const SOURCE_NAME = '7745.by';
const SOURCE_BASE_URL = 'https://7745.by';
const SOURCE_SITEMAP_URL = `${SOURCE_BASE_URL}/sitemap.xml`;

class Skipped7745ProductError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Skipped7745ProductError';
  }
}

@Injectable()
export class Supplier7745ParserService extends SupplierQueueParser {
  protected readonly logger = new Logger(Supplier7745ParserService.name);
  protected readonly supplier: SupplierInfo = {
    code: '7745',
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
    return error instanceof Skipped7745ProductError;
  }

  async refreshSitemaps() {
    await this.upsertSource();
    const xml = await this.fetchText(SOURCE_SITEMAP_URL);
    await this.enqueueUrls(this.parseSitemapUrls(xml));

    for (const sitemapUrl of this.parseSitemapIndexUrls(xml)) {
      const productXml = await this.fetchText(sitemapUrl);
      await this.enqueueUrls(this.parseSitemapUrls(productXml));
    }

    return this.getQueueStats();
  }

  async parseProductUrl(url: string) {
    /**
     * The offer's identity, and it has to be the same spelling everything else
     * uses: `parseSitemapUrls()` queues `canonicalUrl()` output and
     * `processSitemapUrl()` withdraws a 404'd offer under `canonicalUrl(url)`.
     * Saving under `absoluteUrl(url)` instead kept whatever the caller passed —
     * an admin pasting a link with a `#anchor` stored the offer under a key
     * nothing looks up, so the supplier could delete the product and the dead
     * price would stay on the storefront, and the same page read again from
     * the queue became a second offer rather than an update.
     */
    const offerUrl = this.canonicalUrl(url);
    const html = await this.fetchText(offerUrl);
    const $ = cheerio.load(html);
    const parsed = parse7745(html);
    if (!parsed.name) throw new Error('Product name was not parsed');
    if (this.isVerificationPage($, parsed.name)) {
      throw new Error('7745 anti-bot verification page was returned');
    }

    const source = await this.upsertSource();
    const breadcrumbs = this.parseBreadcrumbs($);
    await this.ensureAllowedCategory(breadcrumbs);
    const { sourceCategoryId, categoryId } = await this.parseAndSaveCategories(
      source.id,
      breadcrumbs,
    );
    const sku = this.findSpecValue(parsed.specifications, [
      'артикул',
      'код товара',
      'sku',
    ]);
    const model = this.findSpecValue(parsed.specifications, ['модель']);
    const barcode = this.findSpecValue(parsed.specifications, [
      'штрихкод',
      'ean',
      'gtin',
    ]);
    const brandName = this.findSpecValue(parsed.specifications, [
      'производитель',
      'бренд',
      'торговая марка',
    ]);
    const brandId = brandName
      ? await this.identity.upsertBrand(brandName)
      : undefined;
    const slug = this.productSlug(parsed.name, sku);
    const seoTitle = this.parseMeta($, 'og:title') || parsed.name;
    const seoDescription =
      this.parseMeta($, 'description') || parsed.description || parsed.name;
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
          model,
          barcode,
          brandId,
          categoryId,
          // priceValue is deliberately absent: PricingService owns the storefront
          // price so markup rules apply and MANUAL prices aren't clobbered.
          priceCurrency: 'BYN',
          stockStatus:
            parsed.inStock === undefined
              ? 'unknown'
              : parsed.inStock
                ? 'in_stock'
                : 'out_of_stock',
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
          model,
          barcode,
          brandId,
          categoryId,
          priceCurrency: 'BYN',
          stockStatus:
            parsed.inStock === undefined
              ? 'unknown'
              : parsed.inStock
                ? 'in_stock'
                : 'out_of_stock',
          descriptionShort: seoDescription,
          descriptionFull: parsed.description,
          seoTitle,
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
    await this.saveSourceProduct(offerUrl, product.id, source.id, {
      sourceCategoryId,
      name: parsed.name,
      sku,
      model,
      barcode,
      brandName,
      price: parsed.price,
      inStock: parsed.inStock,
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
    const html = await this.fetchText(canonicalUrl);
    const $ = cheerio.load(html);
    const parsed = parse7745(html);
    if (!parsed.name) throw new Error('Product name was not parsed');
    if (this.isVerificationPage($, parsed.name)) {
      throw new Error('7745 anti-bot verification page was returned');
    }

    const breadcrumbs = this.parseBreadcrumbs($);
    const sku = this.findSpecValue(parsed.specifications, [
      'артикул',
      'код товара',
      'sku',
    ]);

    return {
      source: SOURCE_CODE,
      url: canonicalUrl,
      name: parsed.name,
      sku,
      model: this.findSpecValue(parsed.specifications, ['модель']),
      barcode: this.findSpecValue(parsed.specifications, [
        'штрихкод',
        'ean',
        'gtin',
      ]),
      brandName: this.findSpecValue(parsed.specifications, [
        'производитель',
        'бренд',
        'торговая марка',
      ]),
      priceValue: parsed.price,
      priceCurrency: 'BYN',
      description: parsed.description,
      images: parsed.images,
      specifications: parsed.specifications,
      breadcrumbs,
      seoTitle: this.parseMeta($, 'og:title') || parsed.name,
      seoDescription:
        this.parseMeta($, 'description') || parsed.description || parsed.name,
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
      model?: string;
      barcode?: string;
      brandName?: string;
      price?: number;
      inStock?: boolean;
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
        model: data.model,
        inStock: data.inStock ?? null,
        barcode: data.barcode,
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
    const names = breadcrumbs.filter(
      (name) => name && !['Главная', 'Каталог'].includes(name),
    );
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

    const fallback = await this.getFallbackCategory();
    return {
      sourceCategoryId: fallback.sourceCategoryId,
      categoryId: fallback.categoryId,
    };
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
      .filter((url): url is string => Boolean(url?.includes('/product/')))
      .map((url) => this.canonicalUrl(this.absoluteUrl(url)));
  }

  private parseSitemapIndexUrls(xml: string) {
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml) as {
      sitemapindex?: {
        sitemap?: Array<{ loc?: string }> | { loc?: string };
      };
    };
    const entries = Array.isArray(parsed.sitemapindex?.sitemap)
      ? parsed.sitemapindex.sitemap
      : parsed.sitemapindex?.sitemap
        ? [parsed.sitemapindex.sitemap]
        : [];

    return entries
      .map((entry) => entry.loc)
      .filter((url): url is string => Boolean(url?.includes('/products_')))
      .map((url) => this.absoluteUrl(url));
  }

  private async enqueueUrls(urls: string[]) {
    for (const url of [...new Set(urls)].filter((item) =>
      item.startsWith(`${SOURCE_BASE_URL}/product/`),
    )) {
      await this.prisma.sitemaps7745.upsert({
        where: { url },
        update: {},
        create: { url, status: 'PENDING' },
      });
    }
  }

  private parseBreadcrumbs($: cheerio.CheerioAPI) {
    return $(
      '.product-page-crumbs .breadcrumbs > .crumb > .crumb__link > [itemprop="name"], .catalog-header .breadcrumbs > .crumb > .crumb__link > [itemprop="name"], ol.breadcrumbs > li.crumb > a.crumb__link > [itemprop="name"]',
    )
      .map((_, el) => this.clean($(el).text()))
      .get()
      .filter(Boolean);
  }

  private async ensureAllowedCategory(breadcrumbs: string[]) {
    const filters = await this.settings.getCategoryFilters(SOURCE_CODE);
    const haystack = breadcrumbs.join(' / ').toLowerCase();
    const include = this.optionalRegex(filters.include);
    const exclude = this.optionalRegex(filters.exclude);

    if (include && !include.test(haystack)) {
      throw new Skipped7745ProductError(
        `7745 category is outside include filter: ${breadcrumbs.join(' / ')}`,
      );
    }

    if (exclude?.test(haystack)) {
      throw new Skipped7745ProductError(
        `7745 category is excluded: ${breadcrumbs.join(' / ')}`,
      );
    }
  }

  private optionalRegex(value?: string) {
    return value?.trim() ? new RegExp(value, 'i') : undefined;
  }

  private isVerificationPage($: cheerio.CheerioAPI, parsedName: string) {
    const title = this.clean($('title').first().text()).toLowerCase();
    const name = parsedName.toLowerCase();
    return (
      name === 'verification' ||
      title === 'verification' ||
      ($('form[action*="captcha"], script[src*="recaptcha"]').length > 0 &&
        !$('[itemscope][itemtype*="Product"], h1[itemprop="name"]').length)
    );
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

  private clean(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }
}
