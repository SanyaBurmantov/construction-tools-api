import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { SitemapsService } from '../sitemaps/sitemaps.service';
import { ParserLogService } from '../parser-log.service';
import { ParserHttpError } from '../parser-http.error';
import { getParserSource } from '../parser-settings.service';
import {
  TH_TOOLS_BASE_URL,
  isThToolsCategoryUrl,
  parseThToolsCategoryPage,
  thToolsCategoryName,
  thToolsCategoryPageUrl,
  thToolsCategoryPath,
} from '../sites/th-tools-category.crawler';

const TH_TOOLS_SITEMAP_URL = `${TH_TOOLS_BASE_URL}/sitemap.xml`;

/** Pages to walk per category before giving up — a guard against a pager loop. */
const MAX_PAGES_PER_CATEGORY = getPositiveEnvNumber(
  'TH_TOOLS_CATEGORY_MAX_PAGES',
  100,
);
const REQUEST_DELAY_MS = getPositiveEnvNumber(
  'TH_TOOLS_REQUEST_DELAY_MS',
  1500,
);

function getPositiveEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The category queue is the second source of product URLs, next to sitemap.xml.
 * Sitemaps go stale between supplier updates and (on some shops) omit products
 * entirely; walking the category pages finds those. Rows are shared by all
 * sources via `sourceCode`, but only sources with `hasCategoryQueue` have a
 * crawler behind them.
 */
@Injectable()
export class CategoryQueueService {
  private readonly logger = new Logger(CategoryQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sitemaps: SitemapsService,
    private readonly parserLog: ParserLogService,
  ) {}

  /* ------------------------------------------------------------ read ---- */

  async getStats(sourceCode: string) {
    const [queued, done, failed, skipped, disabled, aggregate] =
      await Promise.all([
        this.prisma.parserCategoryQueue.count({
          where: { sourceCode, status: 'PENDING', isEnabled: true },
        }),
        this.prisma.parserCategoryQueue.count({
          where: { sourceCode, status: 'DONE' },
        }),
        this.prisma.parserCategoryQueue.count({
          where: { sourceCode, status: 'FAILED' },
        }),
        this.prisma.parserCategoryQueue.count({
          where: { sourceCode, status: 'SKIPPED' },
        }),
        this.prisma.parserCategoryQueue.count({
          where: { sourceCode, isEnabled: false },
        }),
        this.prisma.parserCategoryQueue.aggregate({
          where: { sourceCode },
          _sum: { productsFound: true, productsQueued: true },
          _count: true,
        }),
      ]);

    return {
      queued,
      visited: done,
      failed,
      skipped,
      disabled,
      total: aggregate._count,
      productsFound: aggregate._sum.productsFound ?? 0,
      productsQueued: aggregate._sum.productsQueued ?? 0,
    };
  }

  async list(query: {
    sourceCode: string;
    search?: string;
    status?: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'PROBLEM' | 'DISABLED';
    page?: number;
    limit?: number;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const where = {
      sourceCode: query.sourceCode,
      ...(query.search
        ? {
            OR: [
              { url: { contains: query.search, mode: 'insensitive' as const } },
              {
                name: { contains: query.search, mode: 'insensitive' as const },
              },
            ],
          }
        : {}),
      ...(query.status === 'PROBLEM'
        ? { status: { in: ['FAILED', 'SKIPPED'] } }
        : query.status === 'DISABLED'
          ? { isEnabled: false }
          : query.status
            ? { status: query.status }
            : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.parserCategoryQueue.findMany({
        where,
        orderBy: [{ level: 'asc' }, { url: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.parserCategoryQueue.count({ where }),
    ]);

    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /* --------------------------------------------------------- mutate ---- */

  async setEnabled(id: string, isEnabled: boolean) {
    const row = await this.prisma.parserCategoryQueue.update({
      where: { id },
      data: { isEnabled },
    });

    // Turning a branch off should also stop products from it being imported,
    // so mirror the flag onto the matching SourceCategory subtree.
    await this.syncSourceCategoryFlag(row.sourceCode, row.path, isEnabled);
    return row;
  }

  async retry(id: string) {
    return this.prisma.parserCategoryQueue.update({
      where: { id },
      data: { status: 'PENDING', lastError: null, visitedAt: null },
    });
  }

  async retryProblems(sourceCode: string) {
    return this.prisma.parserCategoryQueue.updateMany({
      where: { sourceCode, status: { in: ['FAILED', 'SKIPPED'] } },
      data: { status: 'PENDING', lastError: null, visitedAt: null },
    });
  }

  /** Re-queue everything, e.g. before a full refresh of the products queue. */
  async resetAll(sourceCode: string) {
    return this.prisma.parserCategoryQueue.updateMany({
      where: { sourceCode, isEnabled: true },
      data: { status: 'PENDING', lastError: null, visitedAt: null },
    });
  }

  /* -------------------------------------------------------- refresh ---- */

  /** Fill the queue with the supplier's category URLs (from its sitemap). */
  async refresh(sourceCode: string) {
    this.ensureCrawlable(sourceCode);

    const urls =
      await this.sitemaps.getProductUrlsThTools(TH_TOOLS_SITEMAP_URL);
    const categoryUrls = [
      ...new Set(
        urls
          .filter((url) => isThToolsCategoryUrl(url))
          .map((url) => stripQuery(url)),
      ),
    ];

    // createMany skips rows we already have, so an admin's isEnabled=false and
    // the crawl counters survive a refresh.
    const created = await this.prisma.parserCategoryQueue.createMany({
      data: categoryUrls.map((url) => ({
        sourceCode,
        url,
        name: thToolsCategoryName(url),
        path: thToolsCategoryPath(url),
        level: Math.max(thToolsCategoryPath(url).length - 1, 0),
      })),
      skipDuplicates: true,
    });

    this.logger.log(
      `${sourceCode}: category queue refreshed — ${categoryUrls.length} categories seen, ${created.count} new`,
    );

    return { seen: categoryUrls.length, added: created.count };
  }

  /* -------------------------------------------------------- process ---- */

  async processBatch(sourceCode: string, limit = 5) {
    this.ensureCrawlable(sourceCode);

    const rows = await this.prisma.parserCategoryQueue.findMany({
      where: { sourceCode, status: 'PENDING', isEnabled: true },
      orderBy: [{ level: 'asc' }, { url: 'asc' }],
      take: limit,
    });

    let productsQueued = 0;
    for (const row of rows) {
      productsQueued += await this.processCategory(row.id, row.url);
    }

    return {
      categoriesProcessed: rows.length,
      // New product URLs from *this* batch; `stats.productsQueued` below is the
      // all-time total across the queue.
      productsQueuedNow: productsQueued,
      ...(await this.getStats(sourceCode)),
    };
  }

  async processCategory(id: string, url: string) {
    await this.prisma.parserCategoryQueue.update({
      where: { id },
      data: { attempts: { increment: 1 }, lastTriedAt: new Date() },
    });

    try {
      const result = await this.crawlCategory(url);

      await this.prisma.parserCategoryQueue.update({
        where: { id },
        data: {
          status: 'DONE',
          name: result.name ?? thToolsCategoryName(url),
          pagesCrawled: result.pagesCrawled,
          productsFound: result.productUrls.length,
          productsQueued: result.queued,
          lastError: null,
          visitedAt: new Date(),
        },
      });

      return result.queued;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.parserLog.addError(url, error);
      await this.prisma.parserCategoryQueue.update({
        where: { id },
        data: { status: 'FAILED', lastError: message, visitedAt: new Date() },
      });
      this.logger.warn(`Category crawl failed ${url}: ${message}`);
      return 0;
    }
  }

  /**
   * Walks `?page=N` until a page adds no product URL we have not already seen
   * on this category. Webasyst answers out-of-range pages with the last page
   * rather than a 404, so "no new URLs" is the only reliable stop signal.
   */
  private async crawlCategory(url: string) {
    const productUrls = new Set<string>();
    let name: string | undefined;
    let pagesCrawled = 0;

    for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page++) {
      if (page > 1) await this.sleep(REQUEST_DELAY_MS);

      const pageUrl = thToolsCategoryPageUrl(url, page);
      const parsed = parseThToolsCategoryPage(
        await this.fetchText(pageUrl),
        pageUrl,
      );
      pagesCrawled++;
      name ??= parsed.name;

      const before = productUrls.size;
      parsed.productUrls.forEach((productUrl) => productUrls.add(productUrl));
      // Nothing new on this page — either it repeated the last page or the
      // category is exhausted. Either way there is nothing further to walk.
      if (productUrls.size === before) break;
      // The pager links no page beyond the current one.
      if (page >= parsed.maxLinkedPage) break;
    }

    const queued = await this.enqueueProductUrls([...productUrls]);
    return { name, pagesCrawled, productUrls: [...productUrls], queued };
  }

  /** Returns how many URLs were new to the products queue. */
  private async enqueueProductUrls(urls: string[]) {
    if (!urls.length) return 0;

    const before = await this.prisma.sitemapsThTools.count();
    await this.sitemaps.saveSitemaps(urls);
    return (await this.prisma.sitemapsThTools.count()) - before;
  }

  /* ----------------------------------------------------------- utils ---- */

  private async syncSourceCategoryFlag(
    sourceCode: string,
    path: string[],
    isEnabled: boolean,
  ) {
    if (!path.length) return;

    const source = await this.prisma.source.findUnique({
      where: { code: sourceCode },
      select: { id: true },
    });
    if (!source) return;

    // SourceCategory.path is the breadcrumb slug chain, so `hasEvery` on the
    // supplier URL slugs matches the branch and everything under it.
    await this.prisma.sourceCategory.updateMany({
      where: { sourceId: source.id, path: { hasEvery: path } },
      data: { isEnabled },
    });
  }

  private ensureCrawlable(sourceCode: string) {
    const source = getParserSource(sourceCode);
    if (!source?.hasCategoryQueue) {
      throw new BadRequestException(
        `Source "${sourceCode}" has no category crawler`,
      );
    }
  }

  private async fetchText(url: string) {
    const res = await fetchWithTimeout(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
        referer: TH_TOOLS_BASE_URL,
      },
    });
    if (!res.ok) throw new ParserHttpError(res.status, url);
    return res.text();
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function stripQuery(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}
