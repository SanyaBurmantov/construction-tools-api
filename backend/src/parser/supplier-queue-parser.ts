import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OffersService } from '../offers/offers.service';
import { runWithConcurrency } from '../common/utils/run-with-concurrency';
import {
  BatchOutcome,
  BatchResult,
  countOutcome,
  emptyBatchResult,
} from './batch-result';
import { CategoryTreeService } from './categories/category-tree.service';
import { isGoneError } from './parser-http.error';
import { ParserLogService } from './parser-log.service';
import { ParserSettingsService } from './parser-settings.service';
import { ProductIdentityService } from './product-identity.service';
import { claimQueueBatch, queueTable, QueueSourceCode } from './queue-table';

export type QueueStatusFilter =
  | 'PENDING'
  | 'DONE'
  | 'FAILED'
  | 'SKIPPED'
  | 'PROBLEM';

export type SupplierInfo = {
  code: QueueSourceCode;
  name: string;
  baseUrl: string;
};

/** One listing page in a resumable catalogue crawl. */
export type CatalogCrawlEntry = { url: string; failures?: number };

export type CatalogCrawlState = {
  visitedPages: string[];
  pageQueue: unknown[];
};

/** Attempts at one catalogue page before the crawl gives up on it. */
export const MAX_CATALOG_PAGE_FAILURES = 3;

/**
 * Failures in a row, across different pages, after which the site is taken to
 * be down: the crawl stops (resumably) instead of burning every entry's budget.
 */
export const MAX_CONSECUTIVE_CATALOG_FAILURES = 5;

/**
 * Everything a supplier parser does with its URL queue, written once.
 *
 * The four parsers each carried their own copy of the queue stats, listing,
 * retry, batch and per-URL outcome handling — ~80 lines apiece, identical
 * except for the table name — and the copies had started to drift (one
 * logged a saved product, one wrote «404» and another «404/410», one
 * forgot the disabled-branch check). A fix had to be made four times, and
 * missing one was invisible. A parser now supplies only what is genuinely
 * its own: how to parse a product URL, how to spell a URL canonically, and
 * which error means "skip, don't fail".
 */
export abstract class SupplierQueueParser {
  protected abstract readonly logger: Logger;
  protected abstract readonly supplier: SupplierInfo;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly parserLogService: ParserLogService,
    protected readonly offers: OffersService,
    protected readonly categoryTree: CategoryTreeService,
    protected readonly settings: ParserSettingsService,
    protected readonly identity: ProductIdentityService,
  ) {}

  /** Fetches, parses and saves one product page. */
  abstract parseProductUrl(url: string): Promise<unknown>;

  /** The one spelling of a supplier URL the queue and the offer are keyed by. */
  protected abstract canonicalUrl(url: string): string;

  /** The error this parser throws for "not something we import". */
  protected abstract isSkippedError(error: unknown): boolean;

  /** Runs before each batch; a parser with housekeeping overrides it. */
  protected beforeBatch(): Promise<unknown> {
    return Promise.resolve();
  }

  /** The queue table of this supplier. */
  private get queue() {
    return queueTable(this.prisma, this.supplier.code)!;
  }

  protected upsertSource() {
    const { code, name, baseUrl } = this.supplier;
    return this.prisma.source.upsert({
      where: { code },
      update: { name, url: baseUrl },
      create: { name, code, url: baseUrl },
    });
  }

  /* ----------------------------------------------------------- queue ---- */

  async getQueueStats() {
    const [queued, visited, failed, skipped] = await Promise.all([
      this.queue.count({ where: { status: 'PENDING' } }),
      this.queue.count({ where: { status: 'DONE' } }),
      this.queue.count({ where: { status: 'FAILED' } }),
      this.queue.count({ where: { status: 'SKIPPED' } }),
    ]);

    return {
      queued,
      visited,
      failed,
      skipped,
      total: queued + visited + failed + skipped,
    };
  }

  async getSitemaps(query: {
    search?: string;
    status?: QueueStatusFilter;
    page?: number;
    limit?: number;
  }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = {
      ...(query.search
        ? { url: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
      ...(query.status === 'PROBLEM'
        ? { status: { in: ['FAILED', 'SKIPPED'] } }
        : query.status
          ? { status: query.status }
          : {}),
    };
    const [data, total] = await Promise.all([
      this.queue.findMany({
        where,
        orderBy: [{ status: 'asc' }, { url: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.queue.count({ where }),
    ]);

    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /** Back to the queue with a fresh budget and no claim lease to wait out. */
  private static readonly REQUEUE = {
    isVisited: false,
    status: 'PENDING',
    lastError: null,
    attempts: 0,
    lastTriedAt: null,
    visitedAt: null,
  };

  async retrySitemap(id: string) {
    return this.queue.update({
      where: { id },
      data: SupplierQueueParser.REQUEUE,
    });
  }

  async retryProblemSitemaps() {
    return this.queue.updateMany({
      where: { status: { in: ['FAILED', 'SKIPPED'] } },
      data: SupplierQueueParser.REQUEUE,
    });
  }

  /**
   * Puts the whole queue back to PENDING so every product is read again —
   * after a parser fix, or on the monthly schedule. `visitedAt` is kept: the
   * re-read still goes stalest-first, and a never-seen URL still jumps the
   * line. `attempts` is reset: a clean slate, not an old three-strikes count.
   */
  async revalidateAllSitemaps() {
    return this.queue.updateMany({
      data: {
        isVisited: false,
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        lastTriedAt: null,
      },
    });
  }

  async processSitemapsBatch(limit = 30, concurrency = 1) {
    await this.beforeBatch();
    // Claimed, not just read: concurrent workers get disjoint rows.
    const urls = await claimQueueBatch(this.prisma, this.supplier.code, limit);
    // Read once per batch, not per URL: an admin lowering the delay mid-batch
    // should not make the parser speed up against the supplier retroactively.
    const delayMs = await this.settings.getRequestDelayMs(this.supplier.code);

    const batch: BatchResult = emptyBatchResult();
    await runWithConcurrency(urls, concurrency, async (entry) => {
      await this.sleep(delayMs);
      countOutcome(batch, await this.processSitemapUrl(entry.url));
    });

    return { ...(await this.getQueueStats()), batch };
  }

  async processSitemapUrl(url: string): Promise<BatchOutcome> {
    await this.queue.updateMany({
      where: { url },
      data: { attempts: { increment: 1 }, lastTriedAt: new Date() },
    });

    try {
      await this.parseProductUrl(url);
      await this.markVisited(url, 'DONE', null);
      return 'DONE';
    } catch (error) {
      // The supplier removed this product: withdraw the offer and re-price
      // whatever is left, instead of leaving a dead price on the storefront.
      if (isGoneError(error)) {
        await this.withdrawOffer(url);
        await this.markVisited(url, 'SKIPPED', 'Removed by supplier (404/410)');
        this.logger.log(`Delisted ${url}: gone from supplier`);
        return 'DELISTED';
      }

      const message = error instanceof Error ? error.message : String(error);
      // A URL that no longer yields a product we sell — not a product page
      // any more (removed items often redirect to their category), or a
      // category since excluded or switched off — must not leave its old
      // offer live at the last price and stock. A skip is an expected
      // outcome, not a failure: it stays out of the error log.
      if (this.isSkippedError(error)) {
        const withdrawn = await this.withdrawOffer(url);
        await this.markVisited(url, 'SKIPPED', message);
        this.logger.debug(`Skipped ${url}: ${message}`);
        return withdrawn ? 'DELISTED' : 'SKIPPED';
      }

      await this.parserLogService.addError(url, error);
      await this.markVisited(url, 'FAILED', message);
      this.logger.warn(`Failed ${url}: ${message}`);
      return 'FAILED';
    }
  }

  private async withdrawOffer(url: string) {
    const source = await this.upsertSource();
    const result = await this.offers.delistOffer(
      source.id,
      this.canonicalUrl(url),
    );
    return result.delisted;
  }

  private markVisited(
    url: string,
    status: 'DONE' | 'SKIPPED' | 'FAILED',
    lastError: string | null,
  ) {
    return this.queue.updateMany({
      where: { url },
      data: { isVisited: true, status, lastError, visitedAt: new Date() },
    });
  }

  /* ----------------------------------------------- catalog crawl state ---- */

  /**
   * The resumable catalogue crawl lives in one JSON row per source. Both
   * catalog-crawling parsers (dukon, tools.by) read and write it through these
   * two methods so the storage format and the "empty queue clears the row"
   * rule cannot drift apart.
   */
  protected async loadCatalogCrawlState<T>(): Promise<T | undefined> {
    const saved = await this.prisma.parserCatalogCrawl.findUnique({
      where: { sourceCode: this.supplier.code },
    });
    return (saved?.state as T | undefined) ?? undefined;
  }

  protected async saveCatalogCrawlState<T extends CatalogCrawlState>(
    state: T,
  ): Promise<void> {
    if (!state.pageQueue.length) {
      // A completed crawl starts a fresh pass next time.
      await this.prisma.parserCatalogCrawl.deleteMany({
        where: { sourceCode: this.supplier.code },
      });
      return;
    }
    const data = { state: this.toJson(state) };
    await this.prisma.parserCatalogCrawl.upsert({
      where: { sourceCode: this.supplier.code },
      create: { sourceCode: this.supplier.code, ...data },
      update: data,
    });
  }

  /* ----------------------------------------------------------- utils ---- */

  protected toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  protected sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
