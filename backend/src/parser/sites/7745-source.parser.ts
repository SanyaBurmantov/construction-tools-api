import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../../prisma/prisma.service';
import { generateSlug } from '../../common/utils/generate-slug';
import { runWithConcurrency } from '../../common/utils/run-with-concurrency';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { ParserLogService } from '../parser-log.service';
import { parse7745 } from './7745.parser';

type QueueStatus = 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'PROBLEM';
type SavedCategoryRef = { id: string; mappedCategoryId?: string | null };

const SOURCE_CODE = '7745';
const SOURCE_NAME = '7745.by';
const SOURCE_BASE_URL = 'https://7745.by';
const SOURCE_SITEMAP_URL = `${SOURCE_BASE_URL}/sitemap.xml`;
const REQUEST_DELAY_MS = 2000;

class Skipped7745ProductError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Skipped7745ProductError';
  }
}

@Injectable()
export class Supplier7745ParserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parserLogService: ParserLogService,
  ) {}

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

  async getQueueStats() {
    const [queued, visited, failed, skipped] = await Promise.all([
      this.prisma.sitemaps7745.count({ where: { status: 'PENDING' } }),
      this.prisma.sitemaps7745.count({ where: { status: 'DONE' } }),
      this.prisma.sitemaps7745.count({ where: { status: 'FAILED' } }),
      this.prisma.sitemaps7745.count({ where: { status: 'SKIPPED' } }),
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
      this.prisma.sitemaps7745.findMany({
        where,
        orderBy: [{ status: 'asc' }, { url: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sitemaps7745.count({ where }),
    ]);

    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async retrySitemap(id: string) {
    return this.prisma.sitemaps7745.update({
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
    return this.prisma.sitemaps7745.updateMany({
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
    await this.publishDraftProducts();

    const urls = await this.prisma.sitemaps7745.findMany({
      where: { status: 'PENDING' },
      take: limit,
    });

    await runWithConcurrency(urls, concurrency, async (entry) => {
      await this.sleep(REQUEST_DELAY_MS);
      await this.processSitemapUrl(entry.url);
    });

    return this.getQueueStats();
  }

  async processSitemapUrl(url: string) {
    await this.prisma.sitemaps7745.updateMany({
      where: { url },
      data: { attempts: { increment: 1 }, lastTriedAt: new Date() },
    });

    try {
      const product = await this.parseProductUrl(url);
      await this.prisma.sitemaps7745.updateMany({
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
      const isSkipped = error instanceof Skipped7745ProductError;
      if (!isSkipped) {
        await this.parserLogService.addError(url, error);
      }
      await this.prisma.sitemaps7745.updateMany({
        where: { url },
        data: {
          isVisited: true,
          status: isSkipped ? 'SKIPPED' : 'FAILED',
          lastError: error instanceof Error ? error.message : String(error),
          visitedAt: new Date(),
        },
      });
      if (isSkipped) {
        console.warn(`Skipped 7745 URL: ${url}`);
      } else {
        console.error(`Error processing ${url}`, error);
      }
    }
  }

  async parseProductUrl(url: string) {
    const canonicalUrl = this.absoluteUrl(url);
    const html = await this.fetchText(canonicalUrl);
    const $ = cheerio.load(html);
    const parsed = parse7745(html);
    if (!parsed.name) throw new Error('Product name was not parsed');
    if (this.isVerificationPage($, parsed.name)) {
      throw new Error('7745 anti-bot verification page was returned');
    }

    const source = await this.upsertSource();
    const breadcrumbs = this.parseBreadcrumbs($);
    this.ensureAllowedCategory(breadcrumbs);
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

    const product = await this.prisma.product.upsert({
      where: { slug },
      update: {
        ...statusUpdate,
        sku,
        model,
        barcode,
        brandId,
        categoryId,
        priceValue: parsed.price,
        priceCurrency: 'BYN',
        stockStatus: 'unknown',
        descriptionShort: seoDescription,
        descriptionFull: parsed.description,
        seoTitle,
        seoDescription,
        images: {
          deleteMany: {},
          create: parsed.images.map((image, order) => ({
            url: image,
            alt: parsed.name,
            order,
          })),
        },
      },
      create: {
        name: parsed.name,
        slug,
        sku,
        model,
        barcode,
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
        images: {
          create: parsed.images.map((image, order) => ({
            url: image,
            alt: parsed.name,
            order,
          })),
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
      model,
      barcode,
      brandName,
      price: parsed.price,
      description: parsed.description,
      images: parsed.images,
      specifications: parsed.specifications,
      breadcrumbs,
      seoTitle,
      seoDescription,
    });

    return product;
  }

  async previewProductUrl(url: string) {
    const canonicalUrl = this.absoluteUrl(url);
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

  async publishDraftProducts() {
    return this.prisma.product.updateMany({
      where: {
        status: 'DRAFT',
        sourceProducts: { some: { source: { code: SOURCE_CODE } } },
      },
      data: { status: 'PUBLISHED' },
    });
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
        barcode: data.barcode,
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
    const names = breadcrumbs.filter(
      (name) => name && !['Главная', 'Каталог'].includes(name),
    );
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

    const fallback = await this.getFallbackCategory();
    return {
      sourceCategoryId: fallback.sourceCategoryId,
      categoryId: fallback.categoryId,
    };
  }

  private async getFallbackCategory() {
    const source = await this.upsertSource();
    const sourceCategory = await this.prisma.sourceCategory.upsert({
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
    });
    const category = await this.prisma.category.upsert({
      where: { slug: 'unmapped-supplier-products' },
      update: {},
      create: {
        name: 'Неразобранные товары поставщиков',
        slug: 'unmapped-supplier-products',
        level: 0,
        path: ['unmapped-supplier-products'],
        seoTitle: 'Неразобранные товары поставщиков',
        seoDescription: 'Неразобранные товары поставщиков',
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

  private ensureAllowedCategory(breadcrumbs: string[]) {
    const haystack = breadcrumbs.join(' / ').toLowerCase();
    const include = this.optionalRegex(
      process.env.SUPPLIER_7745_CATEGORY_INCLUDE_REGEX,
    );
    const exclude = this.optionalRegex(
      process.env.SUPPLIER_7745_CATEGORY_EXCLUDE_REGEX,
    );

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
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
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

  private clean(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
