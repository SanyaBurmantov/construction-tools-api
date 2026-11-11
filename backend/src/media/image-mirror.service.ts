import { SupplierConnectionService } from '../parser/connection/supplier-connection.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import { ResponseTooLargeError } from '../common/utils/fetch-with-timeout';
import { PLACEHOLDER_IMAGE_MARKERS } from '../common/utils/product-images';
import { runsBackgroundJobs } from '../common/utils/process-role';
import { mapWithConcurrency } from '../common/utils/run-with-concurrency';
import {
  publicReadPolicy,
  S3Client,
  s3ConfigFromEnv,
  S3Error,
} from '../common/utils/s3-client';
import {
  hostOf,
  MAX_IMAGE_BYTES,
  MediaConfig,
  mediaConfigFromEnv,
  sniffImageType,
} from './image-mirror';
import {
  renderVariants,
  Variant,
  VARIANT_CAPS,
  variantKey,
} from './image-variants';

/** Photos per tick, and how many are fetched at once. */
const BATCH = 40;
const CONCURRENCY = 4;
/** A supplier host that did not answer is left alone this long. */
const HOST_DOWN_MS = 30 * 60_000;
const ALERT_EVERY_MS = 6 * 3600_000;
/** A full pass found nothing to copy: look again after this long. */
const IDLE_AFTER_EMPTY_PASS_MS = 10 * 60_000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

type Outcome = 'stored' | 'relinked' | 'failed' | 'host-down' | 's3-error';

/**
 * Copies supplier photos into our S3 bucket and points `ProductImage.url` at
 * the copy (`sourceUrl` keeps the supplier's). Runs in the worker, on its own,
 * with no button: the catalogue is walked in supplier-URL order, new photos
 * from a parse are reached within one pass.
 *
 * - The parsers keep writing supplier URLs; ProductIdentityService.save()
 *   swaps in a stored copy, so the daily re-parse does not undo the work.
 * - A photo that fails (404, an HTML page, too big) is retried with backoff:
 *   after 30/60 min, then every 3 days. A host that does not answer at all
 *   (th-tool.by blocks the prod server) is skipped for 30 min instead of
 *   costing each of its photos a timeout.
 * - Stored already resized (media/image-variants.ts): WebP at caps
 *   160/320/640/1200, and `ProductImage.url` names the largest — the
 *   storefront picks a size from it and IPX never fetches a copied photo.
 *   The original is not kept; the 1200 cap is the zoom.
 * - The keys come from the URL alone and the largest cap is written last, so
 *   a copy that already exists is found by HEAD and never downloaded twice.
 * - Above S3_MEDIA_MAX_GB (30) copying stops — the bucket also holds the
 *   database backups.
 *
 * A photo the storefront still shows from the supplier is not broken: the
 * copy only makes it independent of the supplier.
 */
@Injectable()
export class ImageMirrorService implements OnModuleInit {
  private readonly logger = new Logger(ImageMirrorService.name);
  private readonly media: MediaConfig | null = mediaConfigFromEnv();
  private readonly s3: S3Client | null;
  private running = false;
  private bucketReady = false;
  private readonly downHosts = new Map<string, number>();
  private lastAlertAt = 0;
  private quotaWarned = false;
  /** Where the candidate walk stopped (`sourceUrl` order); '' = from the start. */
  private cursor = '';
  private idleUntil = 0;
  /** sharp runs one photo at a time: decoding is the memory peak. */
  private renderChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly connection: SupplierConnectionService,
  ) {
    const config = s3ConfigFromEnv();
    this.s3 = config && this.media ? new S3Client(config) : null;
  }

  get enabled(): boolean {
    return this.s3 !== null && this.media !== null;
  }

  onModuleInit() {
    if (!runsBackgroundJobs()) return;
    if (!this.enabled) {
      this.logger.warn(
        'S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_MEDIA_BUCKET not set; product photos stay on supplier hosts',
      );
    }
  }

  /** Bucket and its public-read policy, set by the worker itself. */
  private async ensureBucket(): Promise<boolean> {
    if (this.bucketReady) return true;
    try {
      await this.s3!.ensureBucket(this.media!.bucket);
      await this.s3!.putBucketPolicy(
        this.media!.bucket,
        publicReadPolicy(this.media!.bucket),
      );
      this.bucketReady = true;
      return true;
    } catch (error) {
      await this.alert(
        `Бакет ${this.media!.bucket} недоступен: ${message(error)}`,
      );
      return false;
    }
  }

  @Interval(20_000)
  async tick(): Promise<Record<Outcome, number> | null> {
    if (!runsBackgroundJobs() || !this.enabled || this.running) return null;
    this.running = true;
    try {
      if (!(await this.ensureBucket())) return null;
      if (await this.overQuota()) return null;

      const urls = await this.candidates();
      if (urls.length === 0) return null;

      const counts: Record<Outcome, number> = {
        stored: 0,
        relinked: 0,
        failed: 0,
        'host-down': 0,
        's3-error': 0,
      };
      const outcomes = await mapWithConcurrency(urls, CONCURRENCY, (row) =>
        this.mirrorOne(row.url, row.mirrored).catch((error) => {
          this.logger.warn(`Mirror ${row.url}: ${message(error)}`);
          return 'failed' as Outcome;
        }),
      );
      for (const outcome of outcomes) counts[outcome]++;

      if (counts['s3-error'] > 0 && counts.stored + counts.relinked === 0) {
        await this.alert(
          `Ни одно фото из ${urls.length} не записалось в S3 — проверьте ключи и место в хранилище.`,
        );
      }
      return counts;
    } finally {
      this.running = false;
    }
  }

  /**
   * The next supplier URLs still shown from the supplier: never tried, failed
   * and due again, or stored while some row was written before the copy
   * existed.
   *
   * Walked in `sourceUrl` order from a cursor, over the existing
   * `ProductImage_sourceUrl_idx`: each tick reads only up to the 40th
   * candidate (~30 ms). The first version grouped and sorted all ~244k image
   * rows every 20 s to put published products first — 3.3 s of database time
   * per tick, the second-heaviest statement on the server (2026-11-03). A
   * pass that ends starts over from the beginning (failures that came due
   * are picked up then); a whole pass with nothing to do rests for
   * IDLE_AFTER_EMPTY_PASS_MS instead of re-reading the table.
   */
  private async candidates(): Promise<
    Array<{ url: string; mirrored: boolean }>
  > {
    const now = Date.now();
    if (now < this.idleUntil) return [];
    for (const [host, until] of this.downHosts) {
      if (until <= now) this.downHosts.delete(host);
    }
    const downHosts = [...this.downHosts.keys()];
    const notPlaceholder = Prisma.join(
      PLACEHOLDER_IMAGE_MARKERS.map(
        (marker) => Prisma.sql`lower(i."sourceUrl") NOT LIKE ${`%${marker}%`}`,
      ),
      ' AND ',
    );
    const notDown = downHosts.length
      ? Prisma.sql`AND lower(split_part(i."sourceUrl", '/', 3)) <> ALL(${downHosts})`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{ url: string; mirrored: boolean }>
    >`
      SELECT i."sourceUrl" AS url, bool_or(m.status = 'STORED') AS mirrored
      FROM "ProductImage" i
      LEFT JOIN "ImageMirror" m ON m."sourceUrl" = i."sourceUrl"
      WHERE i."sourceUrl" > ${this.cursor}
        AND i."url" = i."sourceUrl"
        AND i."sourceUrl" ~* '^https?://[^/]+/'
        AND ${notPlaceholder}
        ${notDown}
        AND (
          m."sourceUrl" IS NULL
          OR m.status = 'STORED'
          OR m."lastTriedAt" < now() - CASE
               WHEN m.attempts < 3 THEN interval '30 minutes' * m.attempts
               ELSE interval '3 days' END
        )
      GROUP BY i."sourceUrl"
      ORDER BY i."sourceUrl"
      LIMIT ${BATCH}`;

    if (rows.length) {
      this.cursor = rows[rows.length - 1].url;
      // A short page is the end of the table: the next tick starts over.
      if (rows.length < BATCH) this.cursor = '';
    } else if (this.cursor) {
      this.cursor = '';
    } else {
      this.idleUntil = now + IDLE_AFTER_EMPTY_PASS_MS;
    }
    return rows;
  }

  private publicUrl(key: string): string {
    return `${this.media!.publicBase}/${key}`;
  }

  private async mirrorOne(
    sourceUrl: string,
    mirrored: boolean,
  ): Promise<Outcome> {
    const media = this.media!;

    if (mirrored) {
      const row = await this.prisma.imageMirror.findUnique({
        where: { sourceUrl },
      });
      if (row?.key) {
        await this.relink(sourceUrl, this.publicUrl(row.key));
        return 'relinked';
      }
    }

    const host = hostOf(sourceUrl);
    if (this.downHosts.has(host)) return 'host-down';

    // Already in the bucket (a lost row, a crash after the upload): the
    // largest cap present is the stored one — it is always written last.
    for (const cap of [...VARIANT_CAPS].reverse()) {
      const key = variantKey(sourceUrl, cap);
      let size: number | null;
      try {
        size = await this.s3!.headObject(media.bucket, key);
      } catch (error) {
        this.logger.warn(`S3 head ${key}: ${message(error)}`);
        return 's3-error';
      }
      if (size !== null && size > 0) {
        await this.markStored(sourceUrl, key, size);
        return 'stored';
      }
    }

    let body: Buffer;
    try {
      // A supplier's photo goes the way its pages go (direct or proxy) when
      // «фото через прокси» is on; any other host is fetched as it is.
      const res = await this.connection.fetch(
        sourceUrl,
        { headers: { 'user-agent': USER_AGENT, accept: 'image/*' } },
        // Cut off while downloading, not checked after a full buffer.
        { timeoutMs: 15_000, retries: 1, maxBytes: MAX_IMAGE_BYTES },
        'image',
      );
      if (!res.ok) {
        await this.markFailed(sourceUrl, `HTTP ${res.status}`);
        return 'failed';
      }
      body = Buffer.from(await res.arrayBuffer());
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        await this.markFailed(
          sourceUrl,
          `too big: over ${MAX_IMAGE_BYTES} bytes`,
        );
        return 'failed';
      }
      // No answer at all: the host, not this photo. Its other photos wait.
      this.downHosts.set(host, Date.now() + HOST_DOWN_MS);
      this.logger.warn(
        `${host} does not answer; its photos wait 30 min (${message(error)})`,
      );
      await this.markFailed(sourceUrl, `no answer: ${message(error)}`);
      return 'host-down';
    }

    if (body.length > MAX_IMAGE_BYTES) {
      await this.markFailed(sourceUrl, `too big: ${body.length} bytes`);
      return 'failed';
    }
    if (!sniffImageType(body)) {
      await this.markFailed(sourceUrl, 'not an image');
      return 'failed';
    }

    let variants: Variant[];
    try {
      variants = await this.render(body);
    } catch (error) {
      await this.markFailed(sourceUrl, `cannot decode: ${message(error)}`);
      return 'failed';
    }

    // Smallest first: the largest cap is the marker that the set is complete.
    let bytes = 0;
    for (const variant of variants) {
      const key = variantKey(sourceUrl, variant.cap);
      try {
        await this.s3!.putObject(media.bucket, key, variant.body, {
          'content-type': 'image/webp',
          // The key is the URL's hash: a changed photo arrives under a new URL.
          'cache-control': 'public, max-age=31536000, immutable',
        });
      } catch (error) {
        this.logger.warn(`S3 put ${key}: ${message(error)}`);
        if (error instanceof S3Error && error.status === 403)
          this.bucketReady = false;
        return 's3-error';
      }
      bytes += variant.body.length;
    }
    const top = variants[variants.length - 1];
    await this.markStored(sourceUrl, variantKey(sourceUrl, top.cap), bytes);
    return 'stored';
  }

  private render(body: Buffer): Promise<Variant[]> {
    const run = this.renderChain.then(() => renderVariants(body));
    this.renderChain = run.catch(() => undefined);
    return run;
  }

  private async markStored(sourceUrl: string, key: string, bytes: number) {
    const data = {
      status: 'STORED' as const,
      key,
      bytes,
      contentType: 'image/webp',
      error: null,
      lastTriedAt: new Date(),
      storedAt: new Date(),
    };
    await this.prisma.imageMirror.upsert({
      where: { sourceUrl },
      create: { sourceUrl, ...data, attempts: 1 },
      update: { ...data, attempts: { increment: 1 } },
    });
    await this.relink(sourceUrl, this.publicUrl(key));
  }

  /** Every row showing this supplier photo now shows our copy. */
  private relink(sourceUrl: string, url: string) {
    return this.prisma.productImage.updateMany({
      where: { sourceUrl, url: sourceUrl },
      data: { url },
    });
  }

  private markFailed(sourceUrl: string, error: string) {
    const data = {
      status: 'FAILED' as const,
      error: error.slice(0, 500),
      lastTriedAt: new Date(),
    };
    return this.prisma.imageMirror.upsert({
      where: { sourceUrl },
      create: { sourceUrl, ...data, attempts: 1 },
      update: { ...data, attempts: { increment: 1 } },
    });
  }

  private async overQuota(): Promise<boolean> {
    const [{ bytes }] = await this.prisma.$queryRaw<
      Array<{ bytes: bigint | null }>
    >`
      SELECT sum(bytes)::bigint AS bytes FROM "ImageMirror" WHERE status = 'STORED'`;
    const over = Number(bytes ?? 0) >= this.media!.maxBytes;
    if (over && !this.quotaWarned) {
      this.quotaWarned = true;
      await this.alert(
        `Фото в S3 заняли ${(Number(bytes) / 1024 ** 3).toFixed(1)} ГБ — достигнут предел S3_MEDIA_MAX_GB, копирование остановлено.`,
      );
    }
    return over;
  }

  private async alert(reason: string) {
    this.logger.error(reason);
    if (Date.now() - this.lastAlertAt < ALERT_EVERY_MS) return;
    this.lastAlertAt = Date.now();
    await this.telegram
      .notifyParserProblem({
        key: 'image-mirror',
        label: 'Копирование фото в S3',
        reason,
      })
      .catch(() => undefined);
  }

  /** Progress for the admin: how much of the catalogue is served from our copy. */
  async stats() {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        images: bigint;
        ours: bigint;
        stored: bigint;
        stored_bytes: bigint | null;
        failed: bigint;
      }>
    >`
      SELECT
        (SELECT count(*) FROM "ProductImage") AS images,
        (SELECT count(*) FROM "ProductImage" WHERE "url" <> "sourceUrl") AS ours,
        (SELECT count(*) FROM "ImageMirror" WHERE status = 'STORED') AS stored,
        (SELECT sum(bytes)::bigint FROM "ImageMirror" WHERE status = 'STORED') AS stored_bytes,
        (SELECT count(*) FROM "ImageMirror" WHERE status = 'FAILED') AS failed`;
    const failedByHost = await this.prisma.$queryRaw<
      Array<{ host: string; count: bigint }>
    >`
      SELECT lower(split_part("sourceUrl", '/', 3)) AS host, count(*) AS count
      FROM "ImageMirror" WHERE status = 'FAILED'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`;
    return {
      enabled: this.enabled,
      bucket: this.media?.bucket ?? null,
      images: Number(row.images),
      servedFromOurStorage: Number(row.ours),
      storedPhotos: Number(row.stored),
      storedBytes: Number(row.stored_bytes ?? 0),
      maxBytes: this.media?.maxBytes ?? null,
      failedPhotos: Number(row.failed),
      failedByHost: failedByHost.map((r) => ({
        host: r.host,
        count: Number(r.count),
      })),
    };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
