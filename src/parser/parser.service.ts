import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { PlaywrightService } from './playwright.service';

export interface ParsedProduct {
  name: string;
  price?: number;
  oldPrice?: number;
  currency?: string;
  brand?: string;
  model?: string;
  article?: string;
  barcode?: string;
  description?: string;
  inStock?: boolean;
  stockQuantity?: number;
  availabilityText?: string;
  weight?: number;
  dimensions?: Record<string, any>;
  images?: string[];
  mainImage?: string;
  specifications?: Record<string, any>;
  features?: string[];
  countryOfOrigin?: string;
  warranty?: string;
  manufacturer?: string;
  categoryId?: string;
  sourceUrl: string;
  sourceId?: string;
}

export interface ParserConfig {
  selectors: {
    name?: string;
    price?: string;
    oldPrice?: string;
    brand?: string;
    model?: string;
    article?: string;
    barcode?: string;
    description?: string;
    inStock?: string;
    stockQuantity?: string;
    weight?: string;
    dimensions?: string;
    images?: string;
    mainImage?: string;
    specifications?: {
      container?: string;
      item?: string;
      key?: string;
      value?: string;
    };
    features?: string;
    countryOfOrigin?: string;
    warranty?: string;
    manufacturer?: string;
    categoryId?: string;
    tabs?: string[];  // Селекторы для табов
  };
  pricePattern?: string;
  baseUrl?: string;
  usePlaywright?: boolean;
  waitForSelector?: string;
  waitForTimeout?: number;
  clickTabs?: boolean;  // Кликаем по табам
}

@Injectable()
export class ParserService {
  constructor(private playwrightService: PlaywrightService) {}

  async parseHtml(
    html: string,
    config: ParserConfig,
    url: string,
  ): Promise<ParsedProduct> {
    const $ = cheerio.load(html);
    return this.extractProductData($, config, url);
  }

  async parseWithPlaywright(
    url: string,
    config: ParserConfig,
  ): Promise<ParsedProduct> {
    const selectors: Record<string, string> = {};

    // Map simple selectors
    for (const [key, value] of Object.entries(config.selectors)) {
      if (typeof value === 'string') {
        selectors[key] = value;
      }
    }

    const scrapedData = await this.playwrightService.scrapeWithSelectors(
      url,
      selectors,
      {
        waitForSelector: config.waitForSelector,
        waitForTimeout: config.waitForTimeout,
      },
    );

    // If tabs configured, click them and scrape again
    if (config.clickTabs || config.selectors.tabs) {
      const page = await this.playwrightService.getPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        
        // Click tabs
        await this.clickTabsOnPage(page, config.selectors.tabs);
        
        // Wait for content to load
        await page.waitForTimeout(2000);
        
        // Re-scrape after tabs clicked
        for (const [key, value] of Object.entries(selectors)) {
          if (!scrapedData[key] || !String(scrapedData[key]).trim()) {
            try {
              const element = await page.$(value);
              if (element) {
                const text = await element.textContent();
                if (text && text.trim()) {
                  scrapedData[key] = text.trim();
                }
              }
            } catch {
              // Ignore errors for optional fields
            }
          }
        }
      } finally {
        await page.close();
      }
    }

    // Scrape specifications table if configured
    let specifications: Record<string, any> | undefined;
    if (config.selectors.specifications?.container) {
      specifications = await this.playwrightService.scrapeTable(
        url,
        config.selectors.specifications.container,
        config.selectors.specifications.item || 'tr',
        config.selectors.specifications.key || 'td:first-child',
        config.selectors.specifications.value || 'td:last-child',
      );
    }

    // Convert scraped data to ParsedProduct
    const images = scrapedData['images']
      ? Array.isArray(scrapedData['images'])
        ? scrapedData['images']
        : [scrapedData['images']]
      : [];

    return {
      name: (scrapedData['name'] as string) || 'Unknown',
      price: this.parsePrice(scrapedData['price'] as string),
      oldPrice: this.parsePrice(scrapedData['oldPrice'] as string),
      currency: 'BYN',
      brand: scrapedData['brand'] as string,
      model: scrapedData['model'] as string,
      article: scrapedData['article'] as string,
      barcode: scrapedData['barcode'] as string,
      description: scrapedData['description'] as string,
      inStock: this.extractStockStatusFromText(
        scrapedData['inStock'] as string,
      ),
      stockQuantity: this.parseNumber(scrapedData['stockQuantity'] as string),
      availabilityText: scrapedData['inStock'] as string,
      weight: this.parseNumber(scrapedData['weight'] as string),
      dimensions: this.extractDimensions(scrapedData['dimensions'] as string),
      images,
      mainImage: images[0] || (scrapedData['mainImage'] as string),
      specifications,
      features: scrapedData['features']
        ? Array.isArray(scrapedData['features'])
          ? scrapedData['features']
          : [scrapedData['features']]
        : [],
      countryOfOrigin: scrapedData['countryOfOrigin'] as string,
      warranty: scrapedData['warranty'] as string,
      manufacturer: scrapedData['manufacturer'] as string,
      sourceUrl: url,
      sourceId: this.extractSourceId(url),
    };
  }

  private extractProductData(
    $: cheerio.CheerioAPI,
    config: ParserConfig,
    url: string,
  ): ParsedProduct {
    const extractText = (selector: string | undefined): string | undefined => {
      if (!selector) return undefined;
      const el = $(selector);
      if (el.length === 0) return undefined;
      return el.text()?.trim() || el.attr('content')?.trim();
    };

    const extractNumber = (
      selector: string | undefined,
    ): number | undefined => {
      const text = extractText(selector);
      if (!text) return undefined;
      const cleaned = text.replace(/[^\d,.]/g, '').replace(',', '.');
      return parseFloat(cleaned) || undefined;
    };

    const extractAllText = (selector: string | undefined): string[] => {
      if (!selector) return [];
      const result: string[] = [];
      $(selector).each((_, el) => {
        const text = $(el).text().trim();
        if (text) result.push(text);
      });
      return result;
    };

    const extractImages = (selector: string | undefined): string[] => {
      if (!selector) return [];
      const result: string[] = [];
      $(selector).each((_, el) => {
        const src =
          $(el).attr('src') ||
          $(el).attr('data-src') ||
          $(el).find('img').attr('src');
        if (src) {
          const fullUrl = this.resolveUrl(src, config.baseUrl || url);
          result.push(fullUrl);
        }
      });
      return result;
    };

    const extractSpecifications = (): Record<string, any> | undefined => {
      const specConfig = config.selectors.specifications;
      if (!specConfig?.container) return undefined;

      const specs: Record<string, any> = {};
      $(specConfig.container).each((_, row) => {
        const key = specConfig.key
          ? $(row).find(specConfig.key).text().trim()
          : $(row).children().first().text().trim();
        const value = specConfig.value
          ? $(row).find(specConfig.value).text().trim()
          : $(row).children().last().text().trim();

        if (key && value) {
          specs[key] = value;
        }
      });

      return Object.keys(specs).length > 0 ? specs : undefined;
    };

    const images = extractImages(config.selectors.images);

    return {
      name: extractText(config.selectors.name) || 'Unknown',
      price: extractNumber(config.selectors.price),
      oldPrice: extractNumber(config.selectors.oldPrice),
      currency: 'BYN',
      brand: extractText(config.selectors.brand),
      model: extractText(config.selectors.model),
      article: extractText(config.selectors.article),
      barcode: extractText(config.selectors.barcode),
      description: extractText(config.selectors.description),
      inStock: this.extractStockStatus($, config.selectors.inStock),
      stockQuantity: extractNumber(config.selectors.stockQuantity),
      availabilityText: extractText(config.selectors.inStock),
      weight: extractNumber(config.selectors.weight),
      dimensions: this.extractDimensions(extractText(config.selectors.dimensions)),
      images,
      mainImage: images[0] || extractText(config.selectors.mainImage),
      specifications: extractSpecifications(),
      features: extractAllText(config.selectors.features),
      countryOfOrigin: extractText(config.selectors.countryOfOrigin),
      warranty: extractText(config.selectors.warranty),
      manufacturer: extractText(config.selectors.manufacturer),
      sourceUrl: url,
      sourceId: this.extractSourceId(url),
    };
  }

  private parsePrice(text: string | undefined): number | undefined {
    if (!text) return undefined;
    const cleaned = text.replace(/[^\d,.]/g, '').replace(',', '.');
    return parseFloat(cleaned) || undefined;
  }

  private parseNumber(text: string | undefined): number | undefined {
    if (!text) return undefined;
    const cleaned = text.replace(/[^\d,.]/g, '').replace(',', '.');
    return parseFloat(cleaned) || undefined;
  }

  private extractStockStatus(
    $: cheerio.CheerioAPI,
    selector: string | undefined,
  ): boolean {
    if (!selector) return false;
    const text = $(selector).text().toLowerCase();
    const inStockPatterns = [
      'в наличии',
      'in stock',
      'есть в наличии',
      'доступно',
      'available',
    ];
    return inStockPatterns.some((pattern) => text.includes(pattern));
  }

  private extractStockStatusFromText(text: string | undefined): boolean {
    if (!text) return false;
    const inStockPatterns = [
      'в наличии',
      'in stock',
      'есть в наличии',
      'доступно',
      'available',
    ];
    return inStockPatterns.some((pattern) => text.toLowerCase().includes(pattern));
  }

  private extractDimensions(text: string | undefined): Record<string, any> | undefined {
    if (!text) return undefined;
    const match = text.match(/([\d.,]+)\s*[xх×]\s*([\d.,]+)\s*[xх×]\s*([\d.,]+)/);
    if (match) {
      return {
        length: parseFloat(match[1].replace(',', '.')),
        width: parseFloat(match[2].replace(',', '.')),
        height: parseFloat(match[3].replace(',', '.')),
      };
    }
    return undefined;
  }

  private resolveUrl(url: string, baseUrl: string): string {
    if (url.startsWith('http')) return url;
    const base = new URL(baseUrl);
    if (url.startsWith('/')) {
      return `${base.protocol}//${base.host}${url}`;
    }
    return `${base.protocol}//${base.host}${base.pathname}${url}`;
  }

  private extractSourceId(url: string): string | undefined {
    const patterns = [
      /\/product\/(\d+)/,
      /\/p\/(\d+)/,
      /id=(\d+)/,
      /product_id=(\d+)/,
      /\/([^/]+)\.html$/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return undefined;
  }

  private async clickTabsOnPage(page: any, tabs?: string[]): Promise<void> {
    const tabSelectors = tabs || [
      '.tab-link',
      '.tab-button',
      '[role="tab"]',
      '.nav-tabs a',
      '.tabs a',
      '[data-toggle="tab"]',
      '.accordion-header',
    ];

    for (const selector of tabSelectors) {
      try {
        const tabs = await page.$$(selector);
        for (const tab of tabs) {
          try {
            await tab.click({ timeout: 2000 });
            await page.waitForTimeout(500);
          } catch {
            // Tab might not be clickable
          }
        }
      } catch {
        // Selector not found
      }
    }
  }

  getDefaultConfigForSite(siteName: string): ParserConfig {
    const configs: Record<string, ParserConfig> = {
      'tools.by': {
        usePlaywright: true,
        waitForSelector: 'h1',
        waitForTimeout: 2000,
        selectors: {
          name: 'h1',
          price: '[data-test="product-price-current"], .ProductPrice__current',
          brand: '[data-test="product-brand"] a, .ProductCardInfo__brand',
          article: '[data-test="product-article"], .ProductCardInfo__article',
          inStock: '[data-test="product-stock"], .ProductStock',
          specifications: {
            container: '[data-test="product-specs"] table, .ProductSpecs table',
            item: 'tr',
            key: 'td:first-child',
            value: 'td:last-child',
          },
          images: '.ProductGallery img, .product-gallery img',
          description: '.product-description',
        },
      },
      'th-tool.by': {
        usePlaywright: true,
        waitForSelector: 'h1',
        waitForTimeout: 2000,
        selectors: {
          name: 'h1',
          price: '.price-value, .price',
          brand: '.brand-name, .brand',
          article: '.article, .sku',
          inStock: '.stock-status, .availability',
          specifications: {
            container: '.specs-table, .characteristics',
            item: 'tr',
            key: 'td:first-child',
            value: 'td:last-child',
          },
          images: '.product-images img',
          description: '.product-full-description',
        },
      },
    };

    return (
      configs[siteName] || {
        usePlaywright: false,
        selectors: {
          name: 'h1',
          price: '.price',
          images: 'img',
        },
      }
    );
  }
}
