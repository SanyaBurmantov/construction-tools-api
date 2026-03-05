import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';

import { SourceWebsitesService } from '../source-websites/source-websites.service';
import { ProductsService } from '../products/products.service';
import { CategoriesService } from '../categories/categories.service';

import { ParserService, ParsedProduct, ParserConfig } from './parser.service';
import { PlaywrightService } from './playwright.service';
import { SitemapService } from './sitemap.service';

import { CreateProductDto } from '../products/dto/create-product.dto';

export interface ParseResult {
  success: boolean;
  product?: ParsedProduct;
  error?: string;
}

export interface SitemapParseResult {
  totalUrls: number;
  productUrls: string[];
  sitemaps: string[];
}

export interface MassParseResult {
  total: number;
  success: number;
  failed: number;
  results: ParseResult[];
}

@Injectable()
export class ParserJobService {
  constructor(
    private parserService: ParserService,
    private playwrightService: PlaywrightService,
    private sitemapService: SitemapService,
    private sourceWebsitesService: SourceWebsitesService,
    private productsService: ProductsService,
    private categoriesService: CategoriesService,
  ) {}

  async parseUrl(url: string, sourceWebsiteId?: string): Promise<ParseResult> {
    try {
      let config: ParserConfig;
      let websiteName = 'default';

      if (sourceWebsiteId) {
        const website =
          await this.sourceWebsitesService.findOne(sourceWebsiteId);

        config = (website.parserConfig as unknown as ParserConfig) || {};
        websiteName = website.name;
      } else {
        const hostname = new URL(url).hostname.replace('www.', '');
        websiteName = hostname;
        config = this.parserService.getDefaultConfigForSite(hostname);
      }

      let parsedProduct: ParsedProduct;

      if (config.usePlaywright) {
        parsedProduct = await this.parserService.parseWithPlaywright(
          url,
          config,
        );
      } else {
        const html = await this.fetchHtml(url);

        parsedProduct = await this.parserService.parseHtml(html, config, url);
      }

      const dto: CreateProductDto = {
        name: parsedProduct.name,
        price: parsedProduct.price,
        oldPrice: parsedProduct.oldPrice,
        currency: parsedProduct.currency,
        brand: parsedProduct.brand,
        model: parsedProduct.model,
        article: parsedProduct.article,
        barcode: parsedProduct.barcode,
        description: parsedProduct.description,
        inStock: parsedProduct.inStock,
        stockQuantity: parsedProduct.stockQuantity,
        availabilityText: parsedProduct.availabilityText,
        weight: parsedProduct.weight,
        dimensions: parsedProduct.dimensions,
        images: parsedProduct.images,
        mainImage: parsedProduct.mainImage,
        specifications: parsedProduct.specifications,
        features: parsedProduct.features,
        countryOfOrigin: parsedProduct.countryOfOrigin,
        warranty: parsedProduct.warranty,
        manufacturer: parsedProduct.manufacturer,
        sourceWebsiteId,
      };

      await this.productsService.upsertBySourceUrl(url, dto);

      return {
        success: true,
        product: parsedProduct,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    return response.text();
  }

  async parseSitemap(
    sitemapUrl: string,
    options?: {
      productPattern?: string;
      maxDepth?: number;
    },
  ): Promise<SitemapParseResult> {
    const urls = await this.sitemapService.parseSitemapRecursive(
      sitemapUrl,
      options?.maxDepth || 3,
    );

    let filtered = urls;

    if (options?.productPattern) {
      filtered = this.sitemapService.filterUrlsByPattern(
        urls,
        options.productPattern,
      );
    }

    return {
      totalUrls: filtered.length,
      productUrls: filtered.map((u) => u.loc),
      sitemaps: [],
    };
  }

  async parseProductsFromSitemap(
    sitemapUrl: string,
    sourceWebsiteId?: string,
    options?: {
      productPattern?: string;
      maxDepth?: number;
      concurrency?: number;
      delayMs?: number;
    },
  ): Promise<MassParseResult> {
    const sitemap = await this.parseSitemap(sitemapUrl, options);

    const urls = sitemap.productUrls;
    const concurrency = options?.concurrency || 5;
    const delay = options?.delayMs || 100;

    const results: ParseResult[] = [];

    const batches = this.chunkArray(urls, concurrency);

    for (const batch of batches) {
      const r = await Promise.all(
        batch.map((url) => this.parseUrl(url, sourceWebsiteId)),
      );

      results.push(...r);

      if (delay) await new Promise((r) => setTimeout(r, delay));
    }

    return {
      total: urls.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  async parseCategoryPage(
    url: string,
    sourceWebsiteId: string,
  ): Promise<{ productUrls: string[]; error?: string }> {
    try {
      const website = await this.sourceWebsitesService.findOne(sourceWebsiteId);

      const config = (website.parserConfig as ParserConfig) || {};

      const html = await this.playwrightService.fetchPageContent(url, {
        waitForSelector: config.waitForSelector,
        scroll: true,
      });

      const $ = cheerio.load(html);

      const urls = new Set<string>();

      const selectors = [
        '.product-link a',
        '.product-item a',
        '.catalog-product a',
        '[data-test="product-card"] a',
        '.product a.title',
      ];

      for (const selector of selectors) {
        $(selector).each((_, el) => {
          const href = $(el).attr('href');

          if (!href) return;

          if (!href.includes('/product/')) return;

          urls.add(this.resolveUrl(href, url));
        });
      }

      return { productUrls: Array.from(urls) };
    } catch (error) {
      return {
        productUrls: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async parseMultipleUrls(
    urls: string[],
    sourceWebsiteId?: string,
  ): Promise<ParseResult[]> {
    const results: ParseResult[] = [];

    for (const url of urls)
      results.push(await this.parseUrl(url, sourceWebsiteId));

    return results;
  }

  async parseUrlWithCategory(
    url: string,
    sourceWebsiteId?: string,
  ): Promise<ParseResult> {
    const result = await this.parseUrl(url, sourceWebsiteId);

    if (!result.success || !sourceWebsiteId) return result;

    try {
      const categories = await this.categoriesService.findAll(sourceWebsiteId);

      const path = new URL(url).pathname.split('/').filter(Boolean);

      const category = categories.find((c) => path.includes(c.slug));

      if (!category) return result;

      const product = await this.productsService.findBySourceUrl(url);

      if (!product) return result;

      await this.productsService.update(product.id, {
        categoryId: category.id,
      });
    } catch {}

    return result;
  }

  async parseCategoriesFromSitemap(
    sitemapUrl: string,
    sourceWebsiteId?: string,
  ) {
    const urls = await this.sitemapService.parseSitemapRecursive(sitemapUrl, 3);

    const categoryUrls = urls.filter((u) => u.loc.includes('/category/'));

    const map = new Map<string, any>();

    const categories: any[] = [];

    for (const cat of categoryUrls) {
      const path = new URL(cat.loc).pathname
        .replace('/category/', '')
        .split('/')
        .filter(Boolean);

      let parentId: string | undefined;

      for (let i = 0; i < path.length; i++) {
        const slug = path[i];
        const full = path.slice(0, i + 1).join('/');

        if (map.has(full)) {
          parentId = map.get(full).id;
          continue;
        }

        const created = await this.categoriesService.create({
          name: this.slugToName(slug),
          slug,
          parentId,
          depth: i,
          sourceWebsiteId,
        });

        map.set(full, created);

        parentId = created.id;

        categories.push(created);
      }
    }

    return {
      totalCategories: categories.length,
      categories,
    };
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const res: T[][] = [];

    for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));

    return res;
  }

  private resolveUrl(url: string, base: string) {
    if (url.startsWith('http')) return url;

    const b = new URL(base);

    if (url.startsWith('/')) return `${b.protocol}//${b.host}${url}`;

    return `${b.protocol}//${b.host}/${url}`;
  }

  private slugToName(slug: string) {
    return slug
      .split('-')
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ');
  }
}
