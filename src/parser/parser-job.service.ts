import { Injectable, NotFoundException } from '@nestjs/common';
import { SourceWebsitesService } from '../source-websites/source-websites.service';
import { ProductsService } from '../products/products.service';
import { CategoriesService } from '../categories/categories.service';
import { ParserService, ParsedProduct, ParserConfig } from './parser.service';
import { PlaywrightService } from './playwright.service';
import { SitemapService, SitemapUrl } from './sitemap.service';
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

  async parseUrl(
    url: string,
    sourceWebsiteId?: string,
  ): Promise<ParseResult> {
    try {
      // Get source website and config
      let config: ParserConfig;
      let websiteName = 'default';

      if (sourceWebsiteId) {
        const website = await this.sourceWebsitesService.findOne(
          sourceWebsiteId,
        );
        config = (website.parserConfig as unknown as ParserConfig) || {};
        websiteName = website.name;
      } else {
        // Auto-detect from URL
        const hostname = new URL(url).hostname;
        websiteName = hostname.replace('www.', '');
        config = this.parserService.getDefaultConfigForSite(websiteName);
      }

      let parsedProduct: ParsedProduct;

      // Use Playwright if configured or if it's a known JS-heavy site
      if (config.usePlaywright) {
        console.log(`Using Playwright to parse: ${url}`);
        parsedProduct = await this.parserService.parseWithPlaywright(url, config);
      } else {
        // Fallback to cheerio
        console.log(`Using Cheerio to parse: ${url}`);
        const response = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch URL: ${response.status}`);
        }

        const html = await response.text();
        parsedProduct = await this.parserService.parseHtml(html, config, url);
      }

      // Save or update the product
      const productDto: CreateProductDto = {
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

      const savedProduct = await this.productsService.upsertBySourceUrl(
        url,
        productDto,
      );

      console.log(`Successfully parsed and saved product: ${savedProduct.id}`);

      return {
        success: true,
        product: parsedProduct,
      };
    } catch (error) {
      console.error('Parse error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Parse sitemap and return URLs
   */
  async parseSitemap(
    sitemapUrl: string,
    options?: {
      productPattern?: string;
      maxDepth?: number;
    },
  ): Promise<SitemapParseResult> {
    try {
      console.log(`Parsing sitemap: ${sitemapUrl}`);

      // Parse sitemap recursively (handles nested sitemaps)
      const allUrls = await this.sitemapService.parseSitemapRecursive(
        sitemapUrl,
        options?.maxDepth || 3,
      );

      // Filter URLs by pattern if provided
      let filteredUrls = allUrls;
      if (options?.productPattern) {
        filteredUrls = this.sitemapService.filterUrlsByPattern(
          allUrls,
          options.productPattern,
        );
        console.log(`Filtered to ${filteredUrls.length} product URLs`);
      }

      const productUrls = filteredUrls.map((u) => u.loc);
      const sitemaps = new Set<string>();

      return {
        totalUrls: filteredUrls.length,
        productUrls,
        sitemaps: Array.from(sitemaps),
      };
    } catch (error) {
      console.error('Sitemap parse error:', error);
      throw error;
    }
  }

  /**
   * Parse all products from sitemap
   */
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
    const sitemapResult = await this.parseSitemap(sitemapUrl, {
      productPattern: options?.productPattern,
      maxDepth: options?.maxDepth,
    });

    const urls = sitemapResult.productUrls;
    const concurrency = options?.concurrency || 5;
    const delayMs = options?.delayMs || 100;

    console.log(
      `Parsing ${urls.length} products with concurrency ${concurrency}`,
    );

    const results: ParseResult[] = [];
    const batches = this.chunkArray(urls, concurrency);

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map((url) => this.parseUrl(url, sourceWebsiteId)),
      );
      results.push(...batchResults);

      // Delay between batches to avoid rate limiting
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const success = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      total: urls.length,
      success,
      failed,
      results,
    };
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async parseMultipleUrls(
    urls: string[],
    sourceWebsiteId?: string,
  ): Promise<ParseResult[]> {
    const results: ParseResult[] = [];

    for (const url of urls) {
      const result = await this.parseUrl(url, sourceWebsiteId);
      results.push(result);
    }

    return results;
  }

  async parseCategoryPage(
    url: string,
    sourceWebsiteId: string,
  ): Promise<{ productUrls: string[]; error?: string }> {
    try {
      const website = await this.sourceWebsitesService.findOne(
        sourceWebsiteId,
      );
      const config = (website.parserConfig as unknown as ParserConfig) || {};

      // Use Playwright for category pages (often JS-rendered)
      const html = await this.playwrightService.fetchPageContent(url, {
        waitForSelector: config.waitForSelector,
        scroll: true,
      });

      const $ = cheerio.load(html);
      const productUrls: string[] = [];

      // Try common product link selectors
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
          if (href && href.includes('/product/')) {
            const fullUrl = this.resolveUrl(href, config.baseUrl || url);
            if (!productUrls.includes(fullUrl)) {
              productUrls.push(fullUrl);
            }
          }
        });
      }

      return { productUrls };
    } catch (error) {
      return {
        productUrls: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private resolveUrl(url: string, baseUrl: string): string {
    if (url.startsWith('http')) return url;
    const base = new URL(baseUrl);
    if (url.startsWith('/')) {
      return `${base.protocol}//${base.host}${url}`;
    }
    return `${base.protocol}//${base.host}${base.pathname}${url}`;
  }

  /**
   * Parse categories from sitemap and create them in DB
   */
  async parseCategoriesFromSitemap(
    sitemapUrl: string,
    sourceWebsiteId?: string,
  ): Promise<{
    totalCategories: number;
    categories: any[];
  }> {
    console.log(`Parsing categories from sitemap: ${sitemapUrl}`);

    // Get all URLs from sitemap
    const allUrls = await this.sitemapService.parseSitemapRecursive(sitemapUrl, 3);

    // Filter category URLs
    const categoryUrls = allUrls.filter((u) => u.loc.includes('/category/'));

    console.log(`Found ${categoryUrls.length} category URLs`);

    const categories: any[] = [];

    // Create category tree
    const categoryMap: Map<string, any> = new Map();

    for (const catUrl of categoryUrls) {
      try {
        const url = new URL(catUrl.loc);
        const pathParts = url.pathname.replace('/category/', '').split('/').filter(Boolean);

        let parentId: string | undefined = undefined;
        let categoryId: string | undefined = undefined;

        // Create or get each level of category
        for (let i = 0; i < pathParts.length; i++) {
          const slug = pathParts[i];
          const fullPath = pathParts.slice(0, i + 1).join('/');
          const mapKey = `cat_${fullPath}`;

          if (categoryMap.has(mapKey)) {
            const existing = categoryMap.get(mapKey);
            parentId = existing.id;
            categoryId = parentId;
            continue;
          }

          // Create category
          const categoryData = {
            name: this.slugToName(slug),
            slug: slug,
            parentId: parentId,
            sourceWebsiteId: sourceWebsiteId || undefined,
            depth: i,
          };

          const category = await this.categoriesService.create(categoryData);
          categoryMap.set(mapKey, category);
          parentId = category.id;
          categoryId = parentId;
          categories.push(category);

          console.log(`Created category: ${category.name} (depth: ${i})`);
        }
      } catch (error) {
        console.error(`Failed to create category from ${catUrl.loc}:`, error);
      }
    }

    return {
      totalCategories: categories.length,
      categories,
    };
  }

  /**
   * Parse products with categories from sitemap
   */
  async parseProductsWithCategories(
    sitemapUrl: string,
    sourceWebsiteId?: string,
    options?: {
      productPattern?: string;
      maxDepth?: number;
      concurrency?: number;
      delayMs?: number;
      parseCategoriesFirst?: boolean;
    },
  ): Promise<MassParseResult> {
    // First parse and create categories if requested
    if (options?.parseCategoriesFirst) {
      await this.parseCategoriesFromSitemap(sitemapUrl, sourceWebsiteId);
    }

    // Get all URLs
    const allUrls = await this.sitemapService.parseSitemapRecursive(
      sitemapUrl,
      options?.maxDepth || 3,
    );

    // Filter product URLs (exclude categories, hub, photos, etc.)
    let productUrls = allUrls.filter(
      (u) =>
        !u.loc.includes('/category/') &&
        !u.loc.includes('/hub/') &&
        !u.loc.includes('/photos/') &&
        !u.loc.includes('/o-nas/') &&
        !u.loc.includes('/dealers/') &&
        !u.loc.includes('/garantii/') &&
        !u.loc.includes('/dostavka/') &&
        !u.loc.includes('/kontakty/') &&
        !u.loc.includes('/service-center/') &&
        !u.loc.includes('/obligatsii/') &&
        !u.loc.includes('/politika/') &&
        u.loc !== 'https://th-tool.by/',
    );

    // Apply custom pattern if provided
    if (options?.productPattern) {
      const regex = new RegExp(options.productPattern);
      productUrls = productUrls.filter((u) => regex.test(u.loc));
    }

    console.log(`Parsing ${productUrls.length} products`);

    const urls = productUrls.map((u) => u.loc);
    const concurrency = options?.concurrency || 5;
    const delayMs = options?.delayMs || 100;

    const results: ParseResult[] = [];
    const batches = this.chunkArray(urls, concurrency);

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map((url) => this.parseUrlWithCategory(url, sourceWebsiteId)),
      );
      results.push(...batchResults);

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const success = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      total: urls.length,
      success,
      failed,
      results,
    };
  }

  /**
   * Parse single product and assign to category
   */
  async parseUrlWithCategory(
    url: string,
    sourceWebsiteId?: string,
  ): Promise<ParseResult> {
    const result = await this.parseUrl(url, sourceWebsiteId);

    if (result.success && sourceWebsiteId) {
      try {
        // Extract category from URL path
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);

        if (pathParts.length > 0) {
          // Try to find matching category by slug
          const lastSlug = pathParts[pathParts.length - 1];
          const categories = await this.categoriesService.findAll(sourceWebsiteId);

          // Find category with matching slug
          const matchingCategory = categories.find(
            (c) => c.slug === lastSlug || pathParts.includes(c.slug),
          );

          if (matchingCategory) {
            // Update product with category
            const product = await this.productsService.findOne(result.product!.sourceId || url);
            if (product && product.id) {
              await this.productsService.update(product.id, {
                categoryId: matchingCategory.id,
              });
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to assign category for ${url}:`, error);
      }
    }

    return result;
  }

  private slugToName(slug: string): string {
    // Convert slug to readable name
    // e.g., "gidravlicheskie-pressy" -> "Гидравлические прессы"
    return slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

// Need to import cheerio for the category parsing
import * as cheerio from 'cheerio';
