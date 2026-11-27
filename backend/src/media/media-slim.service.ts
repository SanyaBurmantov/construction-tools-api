import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { runsBackgroundJobs } from '../common/utils/process-role';
import { mapWithConcurrency } from '../common/utils/run-with-concurrency';
import { S3Client, s3ConfigFromEnv } from '../common/utils/s3-client';
import { MediaConfig, mediaConfigFromEnv } from './image-mirror';
import {
  slimPlan,
  SlimPlan,
  URL_1200_PATTERN,
  URL_1200_REPLACEMENT,
} from './media-slim';

/** SiteSetting row: the last `ImageMirror.sourceUrl` done, or `done:<when>`. */
export const MEDIA_SLIM_CURSOR_KEY = 'media.slim.cursor';
/** Sets per tick: ~400 HEADs and one delete of ≤400 keys. */
const BATCH = 200;
const HEAD_CONCURRENCY = 4;

/**
 * Takes the old photo sets (160/320/640/1200) down to 320/640, by itself,
 * once, in the worker (owner, 2026-11-27 — see media-slim.ts for why).
 *
 * Walks `ImageMirror` in `sourceUrl` order from a cursor kept in
 * SiteSetting, so a restart resumes where it stopped. For each batch:
 *  1. HEAD the files that stay — a set missing one is left untouched;
 *  2. point the database at the 640 (`ImageMirror.key`/`bytes`,
 *     `ProductImage.url`) — nothing may name a file before it is deleted;
 *  3. delete 160 and 1200 in one DeleteObjects;
 *  4. only then move the cursor. A failed step leaves it, and the batch is
 *     simply done again next tick (every step is idempotent).
 * When the walk reaches the end it renames the 1200 URLs other tables copied
 * (order lines, category tiles, rows a parse wrote from a stale key) and
 * marks itself done. Deletes work while MinIO answers 507 to writes.
 */
@Injectable()
export class MediaSlimService {
  private readonly logger = new Logger(MediaSlimService.name);
  private readonly media: MediaConfig | null = mediaConfigFromEnv();
  private readonly s3: S3Client | null;
  private running = false;
  private finished = false;
  private sets = 0;
  private deleted = 0;
  private skipped = 0;

  constructor(private readonly prisma: PrismaService) {
    const config = s3ConfigFromEnv();
    this.s3 = config && this.media ? new S3Client(config) : null;
  }

  @Interval(15_000)
  async tick(): Promise<void> {
    if (!runsBackgroundJobs() || !this.s3 || this.finished || this.running)
      return;
    this.running = true;
    try {
      await this.step();
    } catch (error) {
      // S3 busy (503 SlowDown), a network blip: the same batch next tick.
      this.logger.warn(`Photo slimming: ${message(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** One batch; returns false once the whole catalogue is done. */
  async step(): Promise<boolean> {
    const cursor = await this.readCursor();
    if (cursor.startsWith('done:')) {
      this.finished = true;
      return false;
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ sourceUrl: string; key: string }>
    >`
      SELECT "sourceUrl", key FROM "ImageMirror"
      WHERE status = 'STORED' AND key IS NOT NULL AND "sourceUrl" > ${cursor}
      ORDER BY "sourceUrl"
      LIMIT ${BATCH}`;

    if (rows.length === 0) {
      await this.finish();
      return false;
    }

    const planned = rows
      .map((row) => ({ ...row, plan: slimPlan(row.key) }))
      .filter(
        (row): row is { sourceUrl: string; key: string; plan: SlimPlan } =>
          row.plan !== null,
      );

    const checked = await mapWithConcurrency(
      planned,
      HEAD_CONCURRENCY,
      async (row) => {
        let bytes = 0;
        for (const key of row.plan.keep) {
          const size = await this.s3!.headObject(this.media!.bucket, key);
          if (!size) return null;
          bytes += size;
        }
        return { ...row, bytes };
      },
    );
    const ready = checked.filter(
      (row): row is NonNullable<typeof row> => row !== null,
    );
    this.skipped += planned.length - ready.length;

    if (ready.length) {
      const sources = ready.map((r) => r.sourceUrl);
      await this.prisma.$executeRaw`
        UPDATE "ImageMirror" m SET key = v.key, bytes = v.bytes
        FROM unnest(${sources}::text[], ${ready.map((r) => r.plan.key)}::text[],
                    ${ready.map((r) => r.bytes)}::int[]) AS v(source, key, bytes)
        WHERE m."sourceUrl" = v.source AND m.status = 'STORED'`;
      const base = this.media!.publicBase;
      await this.prisma.$executeRaw`
        UPDATE "ProductImage" i SET url = v.new_url
        FROM unnest(${sources}::text[],
                    ${ready.map((r) => `${base}/${r.key}`)}::text[],
                    ${ready.map((r) => `${base}/${r.plan.key}`)}::text[])
             AS v(source, old_url, new_url)
        WHERE i."sourceUrl" = v.source AND i.url = v.old_url
          AND v.old_url <> v.new_url`;

      const keys = ready.flatMap((r) => r.plan.drop);
      const refused = await this.s3!.deleteObjects(this.media!.bucket, keys);
      if (refused.length) {
        throw new Error(
          `S3 refused ${refused.length} of ${keys.length} deletes (${refused[0].key}: ${refused[0].code})`,
        );
      }
      this.sets += ready.length;
      this.deleted += keys.length;
    }

    await this.saveCursor(rows[rows.length - 1].sourceUrl);
    if (this.sets % 10_000 < ready.length) {
      this.logger.log(
        `Photo slimming: ${this.sets} sets done, ${this.deleted} old files deleted, ${this.skipped} left as they were`,
      );
    }
    return true;
  }

  private async finish() {
    const renamed = await this.prisma.$executeRaw`
      UPDATE "ProductImage" SET url = regexp_replace(url, ${URL_1200_PATTERN}, ${URL_1200_REPLACEMENT})
      WHERE url ~ ${URL_1200_PATTERN}`;
    const orderLines = await this.prisma.$executeRaw`
      UPDATE "OrderItem" SET "productImage" = regexp_replace("productImage", ${URL_1200_PATTERN}, ${URL_1200_REPLACEMENT})
      WHERE "productImage" ~ ${URL_1200_PATTERN}`;
    const categories = await this.prisma.$executeRaw`
      UPDATE "Category" SET image = regexp_replace(image, ${URL_1200_PATTERN}, ${URL_1200_REPLACEMENT})
      WHERE image ~ ${URL_1200_PATTERN}`;
    await this.saveCursor(`done:${new Date().toISOString()}`);
    this.finished = true;
    this.logger.log(
      `Photo slimming finished: ${this.sets} sets, ${this.deleted} old files deleted this run, ${this.skipped} left as they were; renamed ${renamed} image rows, ${orderLines} order lines, ${categories} categories`,
    );
  }

  private async readCursor(): Promise<string> {
    const row = await this.prisma.siteSetting.findUnique({
      where: { key: MEDIA_SLIM_CURSOR_KEY },
    });
    return row?.value ?? '';
  }

  private async saveCursor(value: string) {
    await this.prisma.siteSetting.upsert({
      where: { key: MEDIA_SLIM_CURSOR_KEY },
      create: { key: MEDIA_SLIM_CURSOR_KEY, value },
      update: { value },
    });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
