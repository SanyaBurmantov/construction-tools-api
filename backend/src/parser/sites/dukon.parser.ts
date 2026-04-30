import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../../prisma/prisma.service';
import { generateSlug } from '../../common/utils/generate-slug';
import { runWithConcurrency } from '../../common/utils/run-with-concurrency';
import { ParserLogService } from '../parser-log.service';

const DUKON_BASE_URL = 'https://dukon.by';
const DUKON_SITEMAP_URL = `${DUKON_BASE_URL}/sitemap-iblock-7.xml`;
const DUKON_REQUEST_DELAY_MS = 3000;

class NonProductPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonProductPageError';
  }
}

@Injectable()
export class DukonParserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parserLogService: ParserLogService,
  ) {}

  async refreshSitemaps() {
    const res = await fetch(DUKON_SITEMAP_URL, {
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new Error(`Failed to fetch ${DUKON_SITEMAP_URL}`);

    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml) as {
      urlset?: { url?: Array<{ loc?: string }> | { loc?: string } };
    };
    const entries = Array.isArray(parsed.urlset?.url)
      ? parsed.urlset.url
      : parsed.urlset?.url
        ? [parsed.urlset.url]
        : [];
    const urls = entries
      .map((entry) => entry.loc)
      .filter((url): url is string => Boolean(url?.includes('/catalog/')));

    for (const url of urls) {
      await this.prisma.sitemapsDukon.upsert({
        where: { url },
        update: {},
        create: { url, status: 'PENDING' },
      });
    }

    return this.getQueueStats();
  }

  async getQueueStats() {
    const [queued, visited, failed, skipped] = await Promise.all([
      this.prisma.sitemapsDukon.count({ where: { status: 'PENDING' } }),
      this.prisma.sitemapsDukon.count({ where: { status: 'DONE' } }),
      this.prisma.sitemapsDukon.count({ where: { status: 'FAILED' } }),
      this.prisma.sitemapsDukon.count({ where: { status: 'SKIPPED' } }),
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
    status?: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED';
    page?: number;
    limit?: number;
  }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = {
      ...(query.search
        ? { url: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.sitemapsDukon.findMany({
        where,
        orderBy: [{ status: 'asc' }, { url: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sitemapsDukon.count({ where }),
    ]);

    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async retrySitemap(id: string) {
    return this.prisma.sitemapsDukon.update({
      where: { id },
      data: {
        isVisited: false,
        status: 'PENDING',
        lastError: null,
        visitedAt: null,
      },
    });
  }

  async processSitemapsBatch(limit = 25, concurrency = 2) {
    const urls = await this.prisma.sitemapsDukon.findMany({
      where: { status: 'PENDING' },
      take: limit,
    });

    await runWithConcurrency(urls, concurrency, async (entry) => {
      await this.sleep(DUKON_REQUEST_DELAY_MS);
      await this.processSitemapUrl(entry.url);
    });

    return this.getQueueStats();
  }

  async processSitemapUrl(url: string) {
    await this.prisma.sitemapsDukon.updateMany({
      where: { url },
      data: { attempts: { increment: 1 }, lastTriedAt: new Date() },
    });

    try {
      const product = await this.parseProductUrl(url);
      await this.prisma.sitemapsDukon.updateMany({
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
      this.parserLogService.addError(url, error);
      const isSkipped = error instanceof NonProductPageError;
      await this.prisma.sitemapsDukon.updateMany({
        where: { url },
        data: {
          isVisited: true,
          status: isSkipped ? 'SKIPPED' : 'FAILED',
          lastError: error instanceof Error ? error.message : String(error),
          visitedAt: new Date(),
        },
      });
      console.error(`Error processing ${url}`, error);
    }
  }

  async parseProductUrl(url: string) {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);

    const html = await res.text();
    const $ = cheerio.load(html);
    const name = this.clean($('h1').first().text());
    if (!name) throw new Error('Product name was not parsed');
    if (!this.isProductPage($)) {
      throw new NonProductPageError('URL is not a product page');
    }

    const slug = generateSlug(name);
    const specs = this.parseSpecs($);
    const sku = specs.find((spec) => spec.name === 'Артикул')?.value;
    const brandName =
      specs.find((spec) => spec.name === 'Производитель')?.value ||
      this.parseBrand($);
    const priceValue = this.parsePrice($('.price.gen').first().text());
    const descriptionFull = this.parseDescription($);
    const source = await this.upsertSource();
    const { sourceCategoryId, categoryId } = await this.parseAndSaveCategories(
      $,
      source.id,
    );
    const brandId = brandName ? await this.upsertBrand(brandName) : undefined;
    const images = this.parseImages($, name);

    const product = await this.prisma.product.upsert({
      where: { slug },
      update: {
        priceValue,
        priceCurrency: 'BYN',
        sku,
        brandId,
        categoryId,
        images: { deleteMany: {}, create: images },
      },
      create: {
        name,
        slug,
        sku,
        brandId,
        categoryId,
        priceValue,
        priceCurrency: 'BYN',
        stockStatus: 'in_stock',
        status: 'DRAFT',
        descriptionFull,
        seoTitle: name,
        seoDescription: descriptionFull || name,
        images: { create: images },
      },
    });

    await this.saveSpecifications(specs, product.id, categoryId);
    await this.saveSourceProduct(url, product.id, source.id, sourceCategoryId, {
      name,
      priceValue,
      descriptionFull,
      images: images.map((image) => image.url),
      specs,
    });

    return product;
  }

  private async saveSourceProduct(
    url: string,
    productId: string,
    sourceId: string,
    sourceCategoryId: string,
    data: {
      name: string;
      priceValue?: number;
      descriptionFull: string;
      images: string[];
      specs: { name: string; value: string }[];
    },
  ) {
    const sourceProduct = await this.prisma.sourceProduct.findFirst({
      where: { sourceId, url },
    });
    const sourceProductData = {
      sourceId,
      externalId: url,
      url,
      name: data.name,
      price: data.priceValue,
      currency: 'BYN',
      stock: true,
      images: data.images,
      description: data.descriptionFull,
      specifications: Object.fromEntries(
        data.specs.map((spec) => [spec.name, spec.value]),
      ),
      productId,
      sourceCategoryId,
      lastSync: new Date(),
    };

    if (sourceProduct) {
      await this.prisma.sourceProduct.update({
        where: { id: sourceProduct.id },
        data: sourceProductData,
      });
      return;
    }

    await this.prisma.sourceProduct.create({ data: sourceProductData });
  }

  private async parseAndSaveCategories(
    $: cheerio.CheerioAPI,
    sourceId: string,
  ) {
    const names = $('.rsbreadcrumb [itemprop="name"]')
      .map((_, el) => this.clean($(el).text()))
      .get()
      .filter((name) => name && name !== 'Главная' && name !== 'Каталог');

    let parentId: string | null = null;
    const path: string[] = [];
    let sourceCategoryId = '';
    let mappedCategoryId: string | null = null;

    for (const name of names) {
      const slug = generateSlug(name);
      path.push(slug);
      const externalId = path.join('/');
      const sourceCategory = await this.prisma.sourceCategory.upsert({
        where: { sourceId_externalId: { sourceId, externalId } },
        update: {
          name,
          slug,
          parentId,
          level: path.length - 1,
          path: [...path],
        },
        create: {
          sourceId,
          externalId,
          name,
          slug,
          parentId,
          level: path.length - 1,
          path: [...path],
        },
      });
      parentId = sourceCategory.id;
      sourceCategoryId = sourceCategory.id;
      mappedCategoryId = sourceCategory.mappedCategoryId;
    }

    if (sourceCategoryId) {
      return {
        sourceCategoryId,
        categoryId: mappedCategoryId || (await this.getFallbackCategoryId()),
      };
    }

    const sourceCategory = await this.prisma.sourceCategory.upsert({
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
    });

    return {
      sourceCategoryId: sourceCategory.id,
      categoryId:
        sourceCategory.mappedCategoryId || (await this.getFallbackCategoryId()),
    };
  }

  private async getFallbackCategoryId() {
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
    return category.id;
  }

  private upsertSource() {
    return this.prisma.source.upsert({
      where: { code: 'dukon' },
      update: { name: 'Dukon', url: DUKON_BASE_URL },
      create: { name: 'Dukon', code: 'dukon', url: DUKON_BASE_URL },
    });
  }

  private async upsertBrand(name: string) {
    const slug = generateSlug(name);
    const brand = await this.prisma.brand.upsert({
      where: { slug },
      update: {},
      create: {
        name,
        slug,
        seoTitle: name,
        seoDescription: name,
      },
    });
    return brand.id;
  }

  private parseSpecs($: cheerio.CheerioAPI) {
    return $('#properties .groupedprops.table .table__item')
      .map((_, el) => ({
        name: this.clean($(el).find('.name').first().text()),
        value: this.clean($(el).find('.val').first().text()),
      }))
      .get()
      .filter((spec) => spec.name && spec.value);
  }

  private isProductPage($: cheerio.CheerioAPI) {
    return Boolean(
      $('#properties .groupedprops.table .table__item').length ||
      $('.price.gen').length ||
      $('.detail-product__info').length,
    );
  }

  private parseBrand($: cheerio.CheerioAPI) {
    const text = this.clean(
      $('.parameters-block__text, .prod-proplist__item')
        .filter((_, el) =>
          this.clean($(el).text()).startsWith('Производитель:'),
        )
        .first()
        .text(),
    );

    return text.replace(/^Производитель:\s*/, '') || undefined;
  }

  private async saveSpecifications(
    specs: { name: string; value: string }[],
    productId: string,
    categoryId: string,
  ) {
    for (const spec of specs) {
      const key = generateSlug(spec.name);
      const specification = await this.prisma.specification
        .upsert({
          where: { categoryId_key: { categoryId, key } },
          update: {},
          create: { name: spec.name, key, categoryId, filterable: true },
        })
        .catch(async (error: unknown) => {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            return this.prisma.specification.findUnique({
              where: { categoryId_key: { categoryId, key } },
            });
          }

          throw error;
        });
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

  private parseImages($: cheerio.CheerioAPI, name: string) {
    const urls = new Set<string>();

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).text()) as { image?: string };
        if (data.image) urls.add(this.absoluteUrl(data.image));
      } catch {
        // Ignore unrelated or invalid schema scripts.
      }
    });

    $(
      '[class*=detail] img, [class*=product] img, [class*=card] img, a[href*="/upload/"]',
    ).each((_, el) => {
      const src =
        $(el).attr('data-src') || $(el).attr('src') || $(el).attr('href');
      if (!src || !src.includes('/upload/') || src.includes('/resize_cache/'))
        return;
      urls.add(this.absoluteUrl(src));
    });

    return [...urls]
      .slice(0, 12)
      .map((url, order) => ({ url, alt: name, order }));
  }

  private parseDescription($: cheerio.CheerioAPI) {
    const text = this.clean(
      $('#detailtext, .detailtext, #description, .content.description')
        .first()
        .text(),
    );
    return text.replace(/^Подробная информация\s*array\(0\) \{ \}\s*/, '');
  }

  private parsePrice(value: string) {
    const price = Number.parseFloat(
      value.replace(/[^\d.,]/g, '').replace(',', '.'),
    );
    return Number.isFinite(price) ? price : undefined;
  }

  private absoluteUrl(url: string) {
    if (url.startsWith('http')) return url;
    return `${DUKON_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private clean(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
