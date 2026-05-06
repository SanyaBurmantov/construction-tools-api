import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as cheerio from 'cheerio';
import { generateSlug } from '../../common/utils/generate-slug';
import { runWithConcurrency } from '../../common/utils/run-with-concurrency';
import { ParserLogService } from '../parser-log.service';

type SavedCategoryRef = { id: string };

const TH_TOOLS_BASE_URL = 'https://th-tool.by';

@Injectable()
export class ThToolsParserService {
  constructor(
    private prisma: PrismaService,
    private parserLogService: ParserLogService,
  ) {}

  async getUnvisitedSitemaps(limit = 10) {
    return this.prisma.sitemapsThTools.findMany({
      where: { isVisited: false },
      take: limit,
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
    try {
      const product = await this.parseProductUrl(url);

      await this.prisma.sitemapsThTools.updateMany({
        where: { url },
        data: { isVisited: true },
      });

      console.log(`Saved product: ${product.name}`);
    } catch (e) {
      await this.parserLogService.addError(url, e);
      console.error(`Error processing ${url}`, e);
    }
  }

  async parseProductUrl(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}`);

    const html = await res.text();
    const $ = cheerio.load(html);

    const name = $('h1').text().trim();

    const brandName = $('.product__top-brand-name').text().trim();
    const sku = $('.product__code span').text().trim();

    const slug = generateSlug(name);

    const description = $('.desc.desc_max').text().trim();

    const priceText = $('.price.product__price').first().text().trim();
    const priceValue = parseFloat(
      priceText.replace(/[^\d.,]/g, '').replace(',', '.'),
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
    const images: { url: string; alt?: string; order: number }[] = [];

    $('.p-images__slider-item').each((i, el) => {
      const src = $(el).attr('href');

      if (src) {
        images.push({
          url: `${TH_TOOLS_BASE_URL}${src}`,
          alt: name,
          order: i,
        });
      }
    });

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

    const product = await this.prisma.product.upsert({
      where: { slug },
      update: {
        ...statusUpdate,
        priceValue,
        priceCurrency,
        descriptionFull: description,
        sku,
        categoryId: categoryId ? categoryId : ' ',
        images: {
          deleteMany: {},
          create: images,
        },
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

    // ---------- SPECS PARSE ----------
    const specs: { name: string; value: string }[] = [];

    $('.features-two-val__block').each((i, block) => {
      const specName = $(block)
        .find('.features-two-val__name span')
        .text()
        .trim();

      const specValue = $(block).find('.features-two-val__value').text().trim();

      if (specName && specValue) {
        specs.push({
          name: specName,
          value: specValue,
        });
      }
    });

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

    console.log(categoryLinks);

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
}
