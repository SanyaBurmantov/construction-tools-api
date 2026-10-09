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
  'politika',
  'hub',
  'brands',
  'htmlmaps',
  'service-center',
  'obligatsii',
  'grafik-postavok',
  'zhurnaly',
  'hit-sale',
  'utsenka',
  'order',
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

  /**
   * Returns what the pass actually did, rather than only logging it.
   *
   * The admin reported `{"seen": 716, "added": 0}` for a supplier with ~39k
   * products and it looked like the sitemap had stopped working. 716 was the
   * *category* queue: this function returned nothing, so the job behind the
   * button could only report the category refresh that runs after it. Counting
   * the sitemap separately is what tells "nothing new to add" apart from
   * "adding is broken".
   */
  async parseAllSitemapsThTools() {
    this.logger.log('Loading https://th-tool.by/sitemap.xml');
    const urls = await this.getProductUrlsThTools(
      'https://th-tool.by/sitemap.xml',
    );
    const productUrls = urls.filter((url) => isThToolsProductUrl(url));
    const queued = await this.saveSitemaps(productUrls);
    this.logger.log(
      `th-tool.by sitemap parsed: ${productUrls.length} product URLs seen, ` +
        `${queued} new, ` +
        `${urls.length - productUrls.length} non-product URLs skipped`,
    );
    return {
      urlsInSitemap: urls.length,
      productUrls: productUrls.length,
      queuedNow: queued,
    };
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

  /** Queues URLs, returning how many were new — `skipDuplicates` ignores the rest. */
  async saveSitemaps(urls: string[]) {
    if (!urls.length) return 0;

    const chunks = chunkArray(urls, 1000);
    let added = 0;

    for (const chunk of chunks) {
      const created = await this.prisma.sitemapsThTools.createMany({
        data: chunk.map((url) => ({
          url,
          isVisited: false,
          status: 'PENDING',
        })),
        skipDuplicates: true,
      });
      added += created.count;
    }

    return added;
  }
}
