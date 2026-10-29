import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';
import { PrismaService } from '../prisma/prisma.service';

/** One IndexNow request may carry up to 10 000 URLs. */
const MAX_URLS_PER_PING = 10_000;
/** A URL Yandex never accepted (bad key, outage) is not kept for ever. */
const MAX_AGE_DAYS = 7;
const ENDPOINT = 'https://yandex.com/indexnow';

/**
 * Tells Yandex (and through IndexNow, Bing) which pages changed, so a
 * rewritten card is re-crawled in days rather than whenever the robot comes
 * by. Google does not take IndexNow; it reads the sitemap's `lastmod`
 * (`Product.contentUpdatedAt`).
 *
 * The key is `INDEXNOW_KEY`; the storefront serves it at `/<key>.txt`
 * (`frontend/server/middleware/indexnow-key.ts`), which is how Yandex checks
 * the site is ours. No key or no `PUBLIC_ORIGIN` — URLs are not even queued.
 * The queue is a table, so a worker restart loses nothing, and a URL is
 * queued once however many times it changes before the next ping.
 */
@Injectable()
export class IndexNowService {
  private readonly logger = new Logger(IndexNowService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get key() {
    return process.env.INDEXNOW_KEY?.trim() || '';
  }

  private get origin() {
    return (process.env.PUBLIC_ORIGIN?.trim() || '').replace(/\/+$/, '');
  }

  get enabled() {
    return Boolean(this.key && /^https:\/\//.test(this.origin));
  }

  /** Queues site paths (`/product/…`, `/catalog/…`). Never throws. */
  async enqueue(paths: Array<string | null | undefined>) {
    if (!this.enabled) return;
    const urls = [...new Set(paths.filter(Boolean) as string[])].map(
      (path) => `${this.origin}${path}`,
    );
    if (!urls.length) return;
    try {
      await this.prisma.indexNowUrl.createMany({
        data: urls.map((url) => ({ url })),
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.warn(`IndexNow enqueue failed: ${(error as Error).message}`);
    }
  }

  /** Every 10 minutes, off the parser slots; runs in the worker only. */
  @Cron('0 3,13,23,33,43,53 * * * *')
  async flush() {
    if (!this.enabled) return;
    await this.prisma.indexNowUrl.deleteMany({
      where: {
        createdAt: { lt: new Date(Date.now() - MAX_AGE_DAYS * 86_400_000) },
      },
    });
    const rows = await this.prisma.indexNowUrl.findMany({
      orderBy: { createdAt: 'asc' },
      take: MAX_URLS_PER_PING,
      select: { url: true },
    });
    if (!rows.length) return;

    const host = new URL(this.origin).host;
    try {
      const res = await fetchWithTimeout(
        ENDPOINT,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            host,
            key: this.key,
            keyLocation: `${this.origin}/${this.key}.txt`,
            urlList: rows.map((row) => row.url),
          }),
        },
        { timeoutMs: 30_000, retries: 1 },
      );
      // 200 OK and 202 Accepted (key check pending) both take the list.
      if (res.status === 200 || res.status === 202) {
        await this.prisma.indexNowUrl.deleteMany({
          where: { url: { in: rows.map((row) => row.url) } },
        });
        this.logger.log(`IndexNow: ${rows.length} URL(s) sent to Yandex`);
        return;
      }
      this.logger.warn(
        `IndexNow: Yandex answered ${res.status} — ${(await res.text()).slice(0, 200)}`,
      );
    } catch (error) {
      this.logger.warn(`IndexNow ping failed: ${(error as Error).message}`);
    }
  }
}

/** Storefront paths, in one place. */
export const productPath = (slug: string) => `/product/${slug}`;
export const categoryPath = (slug: string) => `/catalog/${slug}`;
