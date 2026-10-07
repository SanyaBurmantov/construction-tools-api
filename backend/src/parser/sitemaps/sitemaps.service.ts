import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { XMLParser } from 'fast-xml-parser';
import { chunkArray } from '../../common/utils/chunk-array';
import { mapWithConcurrency } from '../../common/utils/run-with-concurrency';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';

type SitemapEntry = { loc: string };

/**
 * th-tool.by product pages are flat single-segment paths (`/some-product/`).
 * The sitemap also lists ~710 `/category/` pages plus static pages; queueing
 * them meant fetching every one over HTTP only to mark it SKIPPED.
 */
const TH_TOOLS_NON_PRODUCT_PATHS = new Set([
  '',
  'o-nas',
  'dealers',
  'garantii',
  'kontakty',
  'dostavka-i-oplata',
  'oplata',
  'dostavka',
  'vozvrat',
  'blog',
  'news',
  'novosti',
  'instruktsii',
  'search',
  'login',
  'signup',
  'cart',
  'checkout',
  'compare',
  'my',
]);

export function isThToolsProductUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }

  const segments = path.split('/').filter(Boolean);
  if (segments.length !== 1) return false;

  return !TH_TOOLS_NON_PRODUCT_PATHS.has(segments[0].toLowerCase());
}

type SitemapXml = {
  sitemapindex?: { sitemap?: SitemapEntry | SitemapEntry[] };
  urlset?: { url?: SitemapEntry | SitemapEntry[] };
};

@Injectable()
export class SitemapsService {
  private readonly logger = new Logger(SitemapsService.name);

  constructor(private prisma: PrismaService) {}

  async parseAllSitemapsThTools() {
    this.logger.log('Loading https://th-tool.by/sitemap.xml');
    const urls = await this.getProductUrlsThTools(
      'https://th-tool.by/sitemap.xml',
    );
    const productUrls = urls.filter((url) => isThToolsProductUrl(url));
    await this.saveSitemaps(productUrls);
    this.logger.log(
      `th-tool.by sitemap parsed: ${productUrls.length} product URLs queued, ` +
        `${urls.length - productUrls.length} non-product URLs skipped`,
    );
  }

  async getProductUrlsThTools(url: string): Promise<string[]> {
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}`);
    }

    const xml = await response.text();

    const parser = new XMLParser();
    const data = parser.parse(xml) as SitemapXml;

    const urls: string[] = [];

    if (data.sitemapindex?.sitemap) {
      const sitemaps: SitemapEntry[] = Array.isArray(data.sitemapindex.sitemap)
        ? data.sitemapindex.sitemap
        : [data.sitemapindex.sitemap];

      const nestedUrls = await mapWithConcurrency(sitemaps, 5, (sitemap) =>
        this.getProductUrlsThTools(sitemap.loc),
      );
      urls.push(...nestedUrls.flat());
    }

    if (data.urlset?.url) {
      const urlList: SitemapEntry[] = Array.isArray(data.urlset.url)
        ? data.urlset.url
        : [data.urlset.url];

      for (const u of urlList) {
        urls.push(u.loc);
      }
    }

    return urls;
  }

  async saveSitemaps(urls: string[]) {
    if (!urls.length) return;

    const chunks = chunkArray(urls, 1000);

    for (const chunk of chunks) {
      await this.prisma.sitemapsThTools.createMany({
        data: chunk.map((url) => ({
          url,
          isVisited: false,
          status: 'PENDING',
        })),
        skipDuplicates: true,
      });
    }
  }
}
