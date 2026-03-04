import { SourceWebsitesService } from '../source-websites/source-websites.service';
import { ProductsService } from '../products/products.service';
import { CategoriesService } from '../categories/categories.service';
import { ParserService, ParsedProduct } from './parser.service';
import { PlaywrightService } from './playwright.service';
import { SitemapService } from './sitemap.service';
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
export declare class ParserJobService {
    private parserService;
    private playwrightService;
    private sitemapService;
    private sourceWebsitesService;
    private productsService;
    private categoriesService;
    constructor(parserService: ParserService, playwrightService: PlaywrightService, sitemapService: SitemapService, sourceWebsitesService: SourceWebsitesService, productsService: ProductsService, categoriesService: CategoriesService);
    parseUrl(url: string, sourceWebsiteId?: string): Promise<ParseResult>;
    parseSitemap(sitemapUrl: string, options?: {
        productPattern?: string;
        maxDepth?: number;
    }): Promise<SitemapParseResult>;
    parseProductsFromSitemap(sitemapUrl: string, sourceWebsiteId?: string, options?: {
        productPattern?: string;
        maxDepth?: number;
        concurrency?: number;
        delayMs?: number;
    }): Promise<MassParseResult>;
    private chunkArray;
    parseMultipleUrls(urls: string[], sourceWebsiteId?: string): Promise<ParseResult[]>;
    parseCategoryPage(url: string, sourceWebsiteId: string): Promise<{
        productUrls: string[];
        error?: string;
    }>;
    private resolveUrl;
    parseCategoriesFromSitemap(sitemapUrl: string, sourceWebsiteId?: string): Promise<{
        totalCategories: number;
        categories: any[];
    }>;
    parseProductsWithCategories(sitemapUrl: string, sourceWebsiteId?: string, options?: {
        productPattern?: string;
        maxDepth?: number;
        concurrency?: number;
        delayMs?: number;
        parseCategoriesFirst?: boolean;
    }): Promise<MassParseResult>;
    parseUrlWithCategory(url: string, sourceWebsiteId?: string): Promise<ParseResult>;
    private slugToName;
}
