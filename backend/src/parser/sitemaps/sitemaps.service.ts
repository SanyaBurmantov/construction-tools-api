import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { XMLParser } from 'fast-xml-parser';
import { chunkArray } from '../../common/utils/chunk-array';
import { mapWithConcurrency } from '../../common/utils/run-with-concurrency';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';

type SitemapEntry = { loc: string };
type SitemapXml = {
  sitemapindex?: { sitemap?: SitemapEntry | SitemapEntry[] };
  urlset?: { url?: SitemapEntry | SitemapEntry[] };
};

@Injectable()
export class SitemapsService {
  constructor(private prisma: PrismaService) {}

  async parseAllSitemapsThTools() {
    console.log(
      'Началась загрузка и проверка сайтмапа https://th-tool.by/sitemap.xml',
    );
    const urls = await this.getProductUrlsThTools(
      'https://th-tool.by/sitemap.xml',
    );
    await this.saveSitemaps(urls);
    console.log('Сайтмап спаршен https://th-tool.by/sitemap.xml');
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
