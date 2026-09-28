import { PlaywrightService } from './playwright.service';
export interface SitemapUrl {
    loc: string;
    lastmod?: string;
    changefreq?: string;
    priority?: string;
}
export interface SitemapParseResult {
    sitemaps: string[];
    urls: SitemapUrl[];
}
export declare class SitemapService {
    private playwrightService;
    constructor(playwrightService: PlaywrightService);
    parseSitemap(url: string): Promise<SitemapParseResult>;
    parseSitemapWithPlaywright(url: string): Promise<SitemapParseResult>;
    private extractSitemapData;
    parseSitemapRecursive(url: string, maxDepth?: number): Promise<SitemapUrl[]>;
    filterUrlsByPattern(urls: SitemapUrl[], pattern: string | RegExp): SitemapUrl[];
    groupUrlsByCategory(urls: SitemapUrl[]): Record<string, SitemapUrl[]>;
}
