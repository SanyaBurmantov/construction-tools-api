import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as cheerio from 'cheerio';
import { PrismaService } from '../../prisma/prisma.service';
import { generateSlug } from '../../common/utils/generate-slug';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { runWithConcurrency } from '../../common/utils/run-with-concurrency';
import { ParserLogService } from '../parser-log.service';
import { OffersService } from '../../offers/offers.service';
import { parseTools } from './tools.parser';

type SavedCategoryRef = { id: string; mappedCategoryId?: string | null };
type QueueStatus = 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'PROBLEM';

const SOURCE_CODE = 'tools-by';
const SOURCE_NAME = 'Tools.by';
const SOURCE_BASE_URL = 'https://tools.by';
const TOOLS_BY_REQUEST_DELAY_MS = 2000;
const TOOLS_BY_DISCOVERY_MAX_PAGES = getPositiveEnvNumber(
  'TOOLS_BY_DISCOVERY_MAX_PAGES',
  500,
);

function getPositiveEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

@Injectable()
export class ToolsByParserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parserLogService: ParserLogService,
    private readonly offers: OffersService,
  ) {}

  async refreshSitemaps() {
    await this.upsertSource();
    const result = await this.discoverCatalogUrls();
    return { ...(await this.getQueueStats()), ...result };
  }

  async discoverCatalogUrls() {
    const visitedPages = new Set<string>();
    const queuedPages = new Set<string>([`${SOURCE_BASE_URL}/catalog`]);
    const pageQueue = [`${SOURCE_BASE_URL}/catalog`];
    const productUrls = new Set<string>();

    while (
      pageQueue.length &&
      visitedPages.size < TOOLS_BY_DISCOVERY_MAX_PAGES
    ) {
      const pageUrl = pageQueue.shift();
      if (!pageUrl || visitedPages.has(pageUrl)) continue;
      visitedPages.add(pageUrl);

      const html = await this.fetchText(pageUrl);
      const $ = cheerio.load(html);
      const pageProductUrls = this.parseProductLinks($);
      pageProductUrls.forEach((url) => productUrls.add(url));
      await this.enqueueUrls(pageProductUrls);

      for (const catalogUrl of this.parseCatalogLinks($)) {
        if (!visitedPages.has(catalogUrl) && !queuedPages.has(catalogUrl)) {
          queuedPages.add(catalogUrl);
          pageQueue.push(catalogUrl);
        }
      }

      await this.sleep(TOOLS_BY_REQUEST_DELAY_MS);
    }

    return {
      visitedPages: visitedPages.size,
      discoveredProducts: productUrls.size,
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

  async processSitemapsBatch(limit = 30, concurrency = 1) {
    const urls = await this.prisma.sitemapsToolsBy.findMany({
      where: { status: 'PENDING' },
      take: limit,
    });

    await runWithConcurrency(urls, concurrency, async (entry) => {
      await this.sleep(TOOLS_BY_REQUEST_DELAY_MS);
      await this.processSitemapUrl(entry.url);
    });

    return this.getQueueStats();
  }

  async processSitemapUrl(url: string) {
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
      return product;
    } catch (error) {
      await this.parserLogService.addError(url, error);
      await this.prisma.sitemapsToolsBy.updateMany({
        where: { url },
        data: {
          isVisited: true,
          status: 'FAILED',
          lastError: error instanceof Error ? error.message : String(error),
          visitedAt: new Date(),
        },
      });
      console.error(`Error processing ${url}`, error);
    }
  }

  async parseProductUrl(url: string) {
    const canonicalUrl = this.absoluteUrl(url);
    const html = await this.fetchText(canonicalUrl);
    const $ = cheerio.load(html);
    const parsed = parseTools(html);
    if (!parsed.name) throw new Error('Product name was not parsed');

    const source = await this.upsertSource();
    const breadcrumbs = this.parseBreadcrumbs($);
    const { sourceCategoryId, categoryId } = await this.parseAndSaveCategories(
      source.id,
      breadcrumbs,
    );
    const sku = this.findSpecValue(parsed.specifications, [
      'артикул',
      'код товара',
      'sku',
    ]);
    const brandName =
      this.findSpecValue(parsed.specifications, ['бренд', 'торговая марка']) ||
      this.parseBrand($);
    const brandId = brandName ? await this.upsertBrand(brandName) : undefined;
    const slug = this.productSlug(parsed.name, sku);
    const existingProduct = await this.prisma.product.findUnique({
      where: { slug },
      select: { status: true },
    });
    const statusUpdate =
      existingProduct?.status === 'DRAFT'
        ? { status: 'PUBLISHED' as const }
        : {};
    const seoTitle = this.parseMeta($, 'og:title') || parsed.name;
    const seoDescription =
      this.parseMeta($, 'description') || parsed.description || parsed.name;
    const images = parsed.images.map((image, order) => ({
      url: image,
      alt: parsed.name,
      order,
    }));
    // Keep existing images if a (possibly flaky) re-parse returned none, so a
    // partial fetch never wipes a product's gallery.
    const imagesUpdate =
      images.length > 0 ? { images: { deleteMany: {}, create: images } } : {};

    const product = await this.prisma.product.upsert({
      where: { slug },
      update: {
        ...statusUpdate,
        sku,
        brandId,
        categoryId,
        // priceValue is deliberately absent: PricingService owns the storefront
        // price so markup rules apply and MANUAL prices aren't clobbered.
        priceCurrency: 'BYN',
        stockStatus: 'unknown',
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
        brandId,
        categoryId,
        priceValue: parsed.price,
        priceCurrency: 'BYN',
        stockStatus: 'unknown',
        status: 'PUBLISHED',
        descriptionShort: seoDescription,
        descriptionFull: parsed.description,
        seoTitle,
        seoDescription,
        images: { create: images },
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
      brandName,
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
    const html = await this.fetchText(canonicalUrl);
    const $ = cheerio.load(html);
    const parsed = parseTools(html);
    if (!parsed.name) throw new Error('Product name was not parsed');

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
      brandName:
        this.findSpecValue(parsed.specifications, [
          'бренд',
          'торговая марка',
        ]) || this.parseBrand($),
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
      brandName?: string;
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
        seoTitle: data.seoTitle,
        seoDescription: data.seoDescription,
        parsedAt: new Date().toISOString(),
      },
    });

    await this.prisma.sourceProduct.upsert({
      where: { sourceId_url: { sourceId, url } },
      update: {
        externalId: url,
        name: data.name,
        sku: data.sku,
        price: data.price,
        currency: 'BYN',
        stock: true,
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
        stock: true,
        images: data.images,
        description: data.description,
        specifications: snapshot,
        productId,
        sourceCategoryId: data.sourceCategoryId,
      },
    });
  }

  private async parseAndSaveCategories(
    sourceId: string,
    breadcrumbs: string[],
  ) {
    const names = breadcrumbs.filter(Boolean);
    let sourceParentId: string | null = null;
    let categoryParentId: string | null = null;
    const path: string[] = [];
    let sourceCategoryId = '';
    let mappedCategoryId: string | null = null;
    let categoryId = '';

    for (const name of names) {
      const slug = generateSlug(name);
      if (!slug) continue;

      path.push(slug);
      const externalId = path.join('/');
      const sourceCategory = (await this.prisma.sourceCategory.upsert({
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
      })) as SavedCategoryRef;
      const category = (await this.prisma.category.upsert({
        where: { slug },
        update: {},
        create: {
          name,
          slug,
          parentId: categoryParentId,
          level: path.length - 1,
          path: [...path],
          seoTitle: name,
          seoDescription: name,
        },
      })) as SavedCategoryRef;

      sourceParentId = sourceCategory.id;
      categoryParentId = category.id;
      sourceCategoryId = sourceCategory.id;
      mappedCategoryId = sourceCategory.mappedCategoryId ?? null;
      categoryId = category.id;
    }

    if (sourceCategoryId) {
      return { sourceCategoryId, categoryId: mappedCategoryId || categoryId };
    }

    const fallback = await this.getFallbackCategory(sourceId);
    return fallback;
  }

  private async getFallbackCategory(sourceId: string) {
    const sourceCategory = await this.prisma.sourceCategory.upsert({
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
    });
    const category = await this.prisma.category.upsert({
      where: { slug: 'tools' },
      update: {},
      create: {
        name: 'Tools',
        slug: 'tools',
        level: 0,
        path: ['tools'],
        seoTitle: 'Tools',
        seoDescription: 'Tools',
      },
    });
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

      const specification = await this.prisma.specification.upsert({
        where: { categoryId_key: { categoryId, key } },
        update: {},
        create: { name: spec.name, key, categoryId, filterable: true },
      });

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

  private async upsertBrand(name: string) {
    const slug = generateSlug(name);
    const brand = await this.prisma.brand.upsert({
      where: { slug },
      update: {},
      create: { name, slug, seoTitle: name, seoDescription: name },
    });
    return brand.id;
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

    $('a[href*="/catalog/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || href.includes('?') || href.includes('#')) return;
      const url = this.canonicalUrl(this.absoluteUrl(href));
      if (url.startsWith(`${SOURCE_BASE_URL}/catalog/`)) urls.add(url);
    });

    return [...urls];
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
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
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
