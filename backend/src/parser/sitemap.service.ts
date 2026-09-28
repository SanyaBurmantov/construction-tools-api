import { Injectable } from '@nestjs/common';
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

@Injectable()
export class SitemapService {
  constructor(private playwrightService: PlaywrightService) {}

  /**
   * Парсинг sitemap.xml файла
   */
  async parseSitemap(url: string): Promise<SitemapParseResult> {
    const result: SitemapParseResult = {
      sitemaps: [],
      urls: [],
    };

    try {
      // Fetch sitemap XML
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/xml,text/xml',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch sitemap: ${response.status}`);
      }

      const xml = await response.text();
      return this.extractSitemapData(xml, url);
    } catch (error) {
      console.error('Sitemap parse error:', error);
      throw error;
    }
  }

  /**
   * Парсинг sitemap с использованием Playwright (для JS-сайтов)
   */
  async parseSitemapWithPlaywright(url: string): Promise<SitemapParseResult> {
    const page = await this.playwrightService.getPage();

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      const xml = await page.content();
      return this.extractSitemapData(xml, url);
    } finally {
      await page.close();
    }
  }

  /**
   * Извлечение данных из XML
   */
  private extractSitemapData(xml: string, baseUrl: string): SitemapParseResult {
    const result: SitemapParseResult = {
      sitemaps: [],
      urls: [],
    };

    // Parse sitemap index (contains other sitemaps)
    const sitemapIndexMatch = xml.match(/<sitemapindex[^>]*>([\s\S]*?)<\/sitemapindex>/i);
    
    if (sitemapIndexMatch) {
      // Extract nested sitemaps
      const sitemapMatches = xml.matchAll(/<sitemap[^>]*>([\s\S]*?)<\/sitemap>/gi);
      for (const match of sitemapMatches) {
        const locMatch = match[1].match(/<loc[^>]*>([^<]*)<\/loc>/i);
        if (locMatch) {
          result.sitemaps.push(locMatch[1].trim());
        }
      }
    } else {
      // Parse URL set (contains actual URLs)
      const urlMatches = xml.matchAll(/<url[^>]*>([\s\S]*?)<\/url>/gi);
      for (const match of urlMatches) {
        const urlData: SitemapUrl = {
          loc: '',
          lastmod: undefined,
          changefreq: undefined,
          priority: undefined,
        };

        const locMatch = match[1].match(/<loc[^>]*>([^<]*)<\/loc>/i);
        if (locMatch) {
          urlData.loc = locMatch[1].trim();
        }

        const lastmodMatch = match[1].match(/<lastmod[^>]*>([^<]*)<\/lastmod>/i);
        if (lastmodMatch) {
          urlData.lastmod = lastmodMatch[1].trim();
        }

        const changefreqMatch = match[1].match(/<changefreq[^>]*>([^<]*)<\/changefreq>/i);
        if (changefreqMatch) {
          urlData.changefreq = changefreqMatch[1].trim();
        }

        const priorityMatch = match[1].match(/<priority[^>]*>([^<]*)<\/priority>/i);
        if (priorityMatch) {
          urlData.priority = priorityMatch[1].trim();
        }

        if (urlData.loc) {
          result.urls.push(urlData);
        }
      }
    }

    return result;
  }

  /**
   * Рекурсивный парсинг всех sitemap (index + nested)
   */
  async parseSitemapRecursive(url: string, maxDepth = 3): Promise<SitemapUrl[]> {
    const allUrls: SitemapUrl[] = [];
    const visited = new Set<string>();

    const processSitemap = async (sitemapUrl: string, depth: number) => {
      if (depth > maxDepth || visited.has(sitemapUrl)) {
        return;
      }

      visited.add(sitemapUrl);
      console.log(`Processing sitemap (${depth}/${maxDepth}): ${sitemapUrl}`);

      try {
        const result = await this.parseSitemap(sitemapUrl);

        // If this sitemap contains other sitemaps, process them recursively
        for (const sitemap of result.sitemaps) {
          await processSitemap(sitemap, depth + 1);
        }

        // Add URLs from this sitemap
        allUrls.push(...result.urls);
      } catch (error) {
        console.error(`Failed to process ${sitemapUrl}:`, error);
      }
    };

    await processSitemap(url, 0);

    console.log(`Total URLs collected: ${allUrls.length}`);
    return allUrls;
  }

  /**
   * Фильтрация URL по паттерну
   */
  filterUrlsByPattern(
    urls: SitemapUrl[],
    pattern: string | RegExp,
  ): SitemapUrl[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return urls.filter((url) => regex.test(url.loc));
  }

  /**
   * Группировка URL по категориям (из path)
   */
  groupUrlsByCategory(urls: SitemapUrl[]): Record<string, SitemapUrl[]> {
    const groups: Record<string, SitemapUrl[]> = {};

    for (const url of urls) {
      try {
        const urlObj = new URL(url.loc);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        
        // Use first path segment as category
        const category = pathParts[0] || 'root';
        
        if (!groups[category]) {
          groups[category] = [];
        }
        groups[category].push(url);
      } catch {
        if (!groups['invalid']) {
          groups['invalid'] = [];
        }
        groups['invalid'].push(url);
      }
    }

    return groups;
  }
}
