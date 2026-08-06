import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as cheerio from 'cheerio';
import { generateSlug } from '../../common/utils/generate-slug';
import { runWithConcurrency } from '../../common/utils/run-with-concurrency';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { ParserLogService } from '../parser-log.service';
import { PricingService } from '../../pricing/pricing.service';

type SavedCategoryRef = { id: string };
type QueueStatus = 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'PROBLEM';

const TH_TOOLS_BASE_URL = 'https://th-tool.by';

class NonProductPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonProductPageError';
  }
}

@Injectable()
export class ThToolsParserService {
  constructor(
    private prisma: PrismaService,
    private parserLogService: ParserLogService,
    private pricing: PricingService,
  ) {}

  async getUnvisitedSitemaps(limit = 10) {
    return this.prisma.sitemapsThTools.findMany({
      where: { status: 'PENDING' },
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

  async processSitemapsBatch(limit = 100, concurrency = 5) {
    await this.publishDraftProducts();

    const urls = await this.getUnvisitedSitemaps(limit);
    if (!urls.length) return;

    await runWithConcurrency(urls, concurrency, async (sitemap) => {
      await this.processSitemapUrl(sitemap.url);
    });
  }

  async publishDraftProducts() {
    return this.prisma.product.updateMany({
      where: {
        status: 'DRAFT',
        sourceProducts: { some: { source: { code: 'th-tools' } } },
      },
      data: { status: 'PUBLISHED' },
    });
  }

  async processSitemapUrl(url: string) {
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

      console.log(`Saved product: ${product.name}`);
    } catch (e) {
      const isSkipped = e instanceof NonProductPageError;
      if (!isSkipped) {
        await this.parserLogService.addError(url, e);
      }
      await this.prisma.sitemapsThTools.updateMany({
        where: { url },
        data: {
          isVisited: true,
          status: isSkipped ? 'SKIPPED' : 'FAILED',
          lastError: e instanceof Error ? e.message : String(e),
          visitedAt: new Date(),
        },
      });
      if (isSkipped) {
        console.warn(`Skipped non-product TH-Tools URL: ${url}`);
      } else {
        console.error(`Error processing ${url}`, e);
      }
    }
  }

  async parseProductUrl(url: string) {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}`);

    const html = await res.text();
    const $ = cheerio.load(html);

    const name = this.parseName($);
    if (!name) throw new Error('Product name was not parsed');
    if (!this.isProductPage(url, $)) {
      throw new NonProductPageError('URL is not a product page');
    }

    const specs = this.parseSpecs($);
    const brandName = this.parseBrand($, specs);
    const sku = this.parseSku($, specs);

    const slug = generateSlug(name);

    const description = this.parseDescription($);

    const priceValue = this.parsePrice(
      $('.price.product__price, [itemprop="price"]').first().attr('content') ||
        $('.price.product__price, [itemprop="price"]').first().text(),
    );
    const priceCurrency = 'BYN';

    // ---------- BRAND ----------
    let brandId: string | undefined;

    if (brandName) {
      const brandSlug = generateSlug(brandName);

      const brand = await this.prisma.brand.upsert({
        where: { slug: brandSlug },
        update: {},
        create: {
          name: brandName,
          slug: brandSlug,
          seoTitle: brandName,
          seoDescription: brandName,
        },
      });

      brandId = brand.id;
    }

    // ---------- IMAGES ----------
    const images = this.parseImages($, name);

    // ---------- PRODUCT ----------
    const { id: categoryId } = await this.parseAndSaveCategory($);
    if (!categoryId) {
      throw new Error(`Category was not parsed for ${slug}`);
    }
    const existingProduct = await this.prisma.product.findUnique({
      where: { slug },
      select: { status: true },
    });
    const statusUpdate =
      existingProduct?.status === 'DRAFT'
        ? { status: 'PUBLISHED' as const }
        : {};
    // Keep existing images if a (possibly flaky) re-parse returned none, so a
    // partial fetch never wipes a product's gallery.
    const imagesUpdate =
      images.length > 0 ? { images: { deleteMany: {}, create: images } } : {};

    const product = await this.prisma.product.upsert({
      where: { slug },
      update: {
        ...statusUpdate,
        // priceValue is deliberately absent: PricingService owns the storefront
        // price so markup rules apply and MANUAL prices aren't clobbered.
        priceCurrency,
        descriptionFull: description,
        sku,
        categoryId: categoryId ? categoryId : ' ',
        ...imagesUpdate,
      },
      create: {
        name,
        slug,
        sku,
        brandId,
        categoryId: categoryId ? categoryId : ' ',
        priceValue,
        priceCurrency,
        status: 'PUBLISHED',
        descriptionFull: description,
        images: {
          create: images,
        },
      },
    });

    // Records the supplier cost and derives the storefront price from the
    // markup rules. No-ops for MANUAL products; flags implausible cost jumps.
    if (priceValue != null) {
      await this.pricing.applyCost(product.id, priceValue);
    }

    // ---------- SPECS PARSE ----------
    // ---------- SAVE SPECS ----------
    await this.saveSpecifications(specs, product.id, categoryId);
    await this.saveSourceProduct(url, product.id, {
      name,
      sku,
      priceValue,
      priceCurrency,
      description,
      images: images.map((image) => image.url),
      specs,
    });

    return product;
  }

  async previewProductUrl(url: string) {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);

    const html = await res.text();
    const $ = cheerio.load(html);
    const name = this.parseName($);
    if (!name) throw new Error('Product name was not parsed');
    if (!this.isProductPage(url, $)) {
      throw new NonProductPageError('URL is not a product page');
    }

    return {
      source: 'th-tools',
      url,
      name,
      sku: this.parseSku($, this.parseSpecs($)),
      brandName: this.parseBrand($, this.parseSpecs($)),
      priceValue: this.parsePrice(
        $('.price.product__price, [itemprop="price"]')
          .first()
          .attr('content') ||
          $('.price.product__price, [itemprop="price"]').first().text(),
      ),
      priceCurrency: 'BYN',
      description: this.parseDescription($),
      images: this.parseImages($, name).map((image) => image.url),
      specifications: this.parseSpecs($),
      breadcrumbs: this.parseBreadcrumbs($),
    };
  }

  private async saveSourceProduct(
    url: string,
    productId: string,
    data: {
      name: string;
      sku?: string;
      priceValue?: number;
      priceCurrency?: string;
      description?: string;
      images: string[];
      specs: { name: string; value: string }[];
    },
  ) {
    const source = await this.prisma.source.upsert({
      where: { code: 'th-tools' },
      update: { name: 'TH-Tools', url: TH_TOOLS_BASE_URL },
      create: { name: 'TH-Tools', code: 'th-tools', url: TH_TOOLS_BASE_URL },
    });

    await this.prisma.sourceProduct.upsert({
      where: { sourceId_url: { sourceId: source.id, url } },
      update: {
        externalId: url,
        name: data.name,
        sku: data.sku,
        price: data.priceValue,
        currency: data.priceCurrency,
        stock: true,
        images: data.images,
        description: data.description,
        specifications: Object.fromEntries(
          data.specs.map((spec) => [spec.name, spec.value]),
        ),
        productId,
        lastSync: new Date(),
      },
      create: {
        sourceId: source.id,
        externalId: url,
        url,
        name: data.name,
        sku: data.sku,
        price: data.priceValue,
        currency: data.priceCurrency,
        stock: true,
        images: data.images,
        description: data.description,
        specifications: Object.fromEntries(
          data.specs.map((spec) => [spec.name, spec.value]),
        ),
        productId,
      },
    });
  }

  async saveSpecifications(
    specs: { name: string; value: string }[],
    productId: string,
    categoryId: string,
  ) {
    for (const spec of specs) {
      const key = generateSlug(spec.name);

      const specification = await this.prisma.specification.upsert({
        where: {
          categoryId_key: {
            categoryId,
            key,
          },
        },
        update: {},
        create: {
          name: spec.name,
          key,
          categoryId,
          filterable: true,
        },
      });

      await this.prisma.productSpecification.upsert({
        where: {
          productId_specificationId: {
            productId,
            specificationId: specification.id,
          },
        },
        update: {
          value: spec.value,
        },
        create: {
          productId,
          specificationId: specification.id,
          value: spec.value,
        },
      });
    }
  }

  async parseAndSaveCategory($: cheerio.CheerioAPI): Promise<{ id: string }> {
    // Берем все ссылки хлебных крошек
    const categoryLinks = $('.bread__link')
      .not('.bread__link_last')
      .map((i, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    if (!categoryLinks.length) {
      // fallback, если что-то не парсится
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
      return { id: category.id };
    }

    // Создаем категории рекурсивно
    let parentId: string | null = null;
    const pathArray: string[] = [];

    for (const name of categoryLinks) {
      const slug = generateSlug(name);
      if (!slug) continue;
      pathArray.push(slug);

      const category = (await this.prisma.category.upsert({
        where: { slug },
        update: {},
        create: {
          name,
          slug,
          level: pathArray.length - 1,
          path: [...pathArray],
          parentId,
          seoTitle: name,
          seoDescription: name,
        },
      })) as SavedCategoryRef;

      parentId = category.id;
    }

    // Возвращаем id конечной категории для продукта
    return { id: parentId! };
  }

  private parseName($: cheerio.CheerioAPI) {
    return this.clean(
      $('h1').first().text() ||
        $('[itemprop="name"]').first().attr('content') ||
        $('[itemprop="name"]').first().text() ||
        this.parseMeta($, 'og:title'),
    );
  }

  private isProductPage(url: string, $: cheerio.CheerioAPI) {
    if (url.includes('/category/')) return false;
    return Boolean(
      $('.product__code span, [itemprop="sku"]').length ||
      $('.price.product__price, [itemprop="price"]').length ||
      $('.features-two-val__block').length ||
      $('.p-images__slider-item').length,
    );
  }

  private parseBreadcrumbs($: cheerio.CheerioAPI) {
    return $('.bread__link')
      .not('.bread__link_last')
      .map((_, el) => this.clean($(el).text()))
      .get()
      .filter(Boolean);
  }

  private parseBrand(
    $: cheerio.CheerioAPI,
    specs: { name: string; value: string }[] = [],
  ) {
    return (
      this.clean(
        $('.product__top-brand-name, .product__brand a, .brand a')
          .first()
          .text(),
      ) ||
      this.findSpecValue(specs, ['бренд', 'поставщик']) ||
      ''
    );
  }

  private parseSku(
    $: cheerio.CheerioAPI,
    specs: { name: string; value: string }[] = [],
  ) {
    return (
      this.clean(
        $('.product__code span, [itemprop="sku"]').first().text() ||
          $('[itemprop="sku"]').first().attr('content'),
      ) ||
      this.findSpecValue(specs, ['артикул', 'код', 'sku']) ||
      ''
    );
  }

  private parseDescription($: cheerio.CheerioAPI) {
    return this.clean(
      $('.desc.desc_max, .product__description, [itemprop="description"]')
        .first()
        .text() || this.parseMeta($, 'description'),
    );
  }

  private parseImages($: cheerio.CheerioAPI, name: string) {
    const urls = new Set<string>();

    $('meta[property="og:image"], .p-images__slider-item, .p-images img').each(
      (_, el) => {
        const src =
          $(el).attr('content') ||
          $(el).attr('href') ||
          $(el).attr('data-src') ||
          $(el).attr('src');
        if (src && this.isProductImage(src)) urls.add(this.absoluteUrl(src));
      },
    );

    return [...urls]
      .slice(0, 12)
      .map((url, order) => ({ url, alt: name, order }));
  }

  private parseSpecs($: cheerio.CheerioAPI) {
    const specs = new Map<string, string>();

    $('.features-two-val__block').each((_, block) => {
      this.addSpec(
        specs,
        $(block).find('.features-two-val__name span').text(),
        $(block).find('.features-two-val__value').text(),
      );
    });

    $('.characteristics tr, .product__specifications tr').each((_, row) => {
      this.addSpec(
        specs,
        $(row).find('th, td').first().text(),
        $(row).find('td').last().text(),
      );
    });

    return [...specs.entries()].map(([name, value]) => ({ name, value }));
  }

  private addSpec(specs: Map<string, string>, name: string, value: string) {
    const cleanName = this.clean(name).replace(/:$/, '');
    const cleanValue = this.clean(value);
    if (cleanName && cleanValue) specs.set(cleanName, cleanValue);
  }

  private findSpecValue(
    specs: { name: string; value: string }[],
    needles: string[],
  ) {
    return specs.find((spec) =>
      needles.some((needle) => spec.name.toLowerCase().includes(needle)),
    )?.value;
  }

  private parseMeta($: cheerio.CheerioAPI, name: string) {
    return this.clean(
      $(`meta[name="${name}"], meta[property="${name}"]`)
        .first()
        .attr('content') || '',
    );
  }

  private parsePrice(value: string) {
    const normalized = value.replace(/\s/g, '').replace(',', '.');
    const match = normalized.match(/\d+(?:\.\d+)?/);
    if (!match) return undefined;

    const price = Number.parseFloat(match[0]);
    return Number.isFinite(price) ? price : undefined;
  }

  private isProductImage(url: string) {
    const normalized = url.toLowerCase();
    return (
      !normalized.startsWith('data:') &&
      !normalized.includes('no_photo') &&
      !normalized.includes('favicon') &&
      /\.(jpe?g|png|webp|svg)(?:\?|$)/.test(normalized)
    );
  }

  private absoluteUrl(url: string) {
    if (url.startsWith('http')) return url;
    return `${TH_TOOLS_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private clean(value?: string) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }
}
