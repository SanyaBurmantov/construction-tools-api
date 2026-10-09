import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// How many historical ParserRun rows to keep per key. Older rows are pruned
// after each run so the table stays bounded (mirrors ParserLogService).
const MAX_RUNS_PER_KEY = 100;

/**
 * Share of hard failures in the last run above which a job counts as broken.
 *
 * A run that fails on nearly every URL still *finishes*, so staleness alone
 * reported it as healthy — which is exactly how a parser dies silently after a
 * supplier changes its markup.
 */
const FAILURE_RATE_THRESHOLD = Number(
  process.env.PARSER_FAILURE_RATE_THRESHOLD ?? 0.5,
);
/** Below this many URLs a batch is too small for a rate to mean anything. */
const MIN_BATCH_FOR_RATE = 5;

export type PriceFreshness = {
  sourceCode: string;
  total: number;
  stale: number;
  stalePercent: number;
  oldestSync: Date | null;
  newestSync: Date | null;
  health: 'OK' | 'STALE' | 'EMPTY';
};

type FreshnessRow = {
  sourceCode: string;
  total: bigint;
  stale: bigint;
  oldestSync: Date | null;
  newestSync: Date | null;
};

function positiveSetting(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class ParserRuntimeStatusService {
  private readonly logger = new Logger(ParserRuntimeStatusService.name);

  // Maps a parser key to its currently-RUNNING ParserRun, so success()/failure()
  // can finalize the row that start() opened without changing call signatures.
  private readonly activeRuns = new Map<
    string,
    { id: string; startedAt: Date }
  >();

  constructor(private readonly prisma: PrismaService) {}

  async start(key: string, label: string) {
    const startedAt = new Date();
    await this.prisma.parserRuntimeStatus.upsert({
      where: { key },
      update: {
        label,
        isRunning: true,
        startedAt,
        finishedAt: null,
        lastError: null,
        runs: { increment: 1 },
      },
      create: {
        key,
        label,
        isRunning: true,
        startedAt,
        runs: 1,
      },
    });

    try {
      const run = await this.prisma.parserRun.create({
        data: { key, label, status: 'RUNNING', startedAt },
        select: { id: true },
      });
      this.activeRuns.set(key, { id: run.id, startedAt });
    } catch (error) {
      // Run history is best-effort; never let it break the actual parser run.
      this.logger.warn(
        `Failed to open ParserRun for ${key}: ${this.message(error)}`,
      );
    }
  }

  async success(key: string, result?: unknown) {
    const now = new Date();
    await this.prisma.parserRuntimeStatus.upsert({
      where: { key },
      update: {
        isRunning: false,
        finishedAt: now,
        lastSuccessAt: now,
        lastResult: this.toJson(result),
        successes: { increment: 1 },
      },
      create: {
        key,
        label: key,
        isRunning: false,
        finishedAt: now,
        lastSuccessAt: now,
        lastResult: this.toJson(result),
        runs: 1,
        successes: 1,
      },
    });

    await this.finishRun(key, now, 'SUCCESS', { result });
  }

  async failure(key: string, error: unknown) {
    const now = new Date();
    const message = this.message(error);
    await this.prisma.parserRuntimeStatus.upsert({
      where: { key },
      update: {
        isRunning: false,
        finishedAt: now,
        lastErrorAt: now,
        lastError: message,
        failures: { increment: 1 },
      },
      create: {
        key,
        label: key,
        isRunning: false,
        finishedAt: now,
        lastErrorAt: now,
        lastError: message,
        runs: 1,
        failures: 1,
      },
    });

    await this.finishRun(key, now, 'FAILED', { error: message });
  }

  /** Finalize the RUNNING ParserRun opened by start() for this key. */
  private async finishRun(
    key: string,
    finishedAt: Date,
    status: 'SUCCESS' | 'FAILED',
    payload: { result?: unknown; error?: string },
  ) {
    const active = this.activeRuns.get(key);
    if (!active) return;
    this.activeRuns.delete(key);

    try {
      // Loosely attribute ParserError rows raised during this run's window.
      const errorCount = await this.prisma.parserError.count({
        where: { createdAt: { gte: active.startedAt, lte: finishedAt } },
      });

      await this.prisma.parserRun.update({
        where: { id: active.id },
        data: {
          status,
          finishedAt,
          durationMs: finishedAt.getTime() - active.startedAt.getTime(),
          errorCount,
          result:
            payload.result === undefined
              ? undefined
              : this.toJson(payload.result),
          error: payload.error,
        },
      });

      await this.pruneRuns(key);
    } catch (error) {
      this.logger.warn(
        `Failed to finalize ParserRun for ${key}: ${this.message(error)}`,
      );
    }
  }

  /** Keep only the most recent MAX_RUNS_PER_KEY runs for a key. */
  private async pruneRuns(key: string) {
    const stale = await this.prisma.parserRun.findMany({
      where: { key },
      orderBy: { startedAt: 'desc' },
      skip: MAX_RUNS_PER_KEY,
      select: { id: true },
    });
    if (stale.length) {
      await this.prisma.parserRun.deleteMany({
        where: { id: { in: stale.map((run) => run.id) } },
      });
    }
  }

  /** Recent run history, newest first. Optionally filtered by key. */
  getRuns(key?: string, limit = 50) {
    return this.prisma.parserRun.findMany({
      where: key ? { key } : undefined,
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  getAll() {
    return this.prisma.parserRuntimeStatus.findMany({
      orderBy: { label: 'asc' },
    });
  }

  async getHealth(maxAgeHours = 2) {
    const priceMaxAgeHours = positiveSetting(
      process.env.PARSER_PRICE_MAX_AGE_HOURS,
      48,
    );
    const priceStalePercent = Math.min(
      positiveSetting(process.env.PARSER_PRICE_STALE_PERCENT, 10),
      100,
    );
    const [statuses, priceFreshness] = await Promise.all([
      this.getAll(),
      this.getPriceFreshness(priceMaxAgeHours, priceStalePercent),
    ]);
    const now = Date.now();
    const jobs = statuses.map((status) => {
      const lastSuccessMs = status.lastSuccessAt?.getTime();
      // TH-tools revalidation is an operator action without a cron schedule.
      const jobMaxAgeHours =
        status.key === 'th-tools-revalidate'
          ? null
          : status.key.endsWith('-revalidate')
            ? 32 * 24
            : status.key.endsWith('-refresh')
              ? 26
              : maxAgeHours;
      const isStale =
        jobMaxAgeHours !== null &&
        (!lastSuccessMs || now - lastSuccessMs > jobMaxAgeHours * 3_600_000);
      const hasError = Boolean(status.lastError);
      const batch = this.lastBatch(status.lastResult);
      const rate =
        batch && batch.processed >= MIN_BATCH_FOR_RATE
          ? batch.failed / batch.processed
          : 0;
      const isFailingHard = rate > FAILURE_RATE_THRESHOLD;

      return {
        ...status,
        maxAgeHours: jobMaxAgeHours,
        failureRate: batch ? Number(rate.toFixed(3)) : null,
        lastBatch: batch,
        health: status.isRunning
          ? 'RUNNING'
          : hasError || isFailingHard
            ? 'ERROR'
            : isStale
              ? 'STALE'
              : 'OK',
      };
    });

    return {
      ok:
        jobs.every((job) => job.health === 'OK' || job.health === 'RUNNING') &&
        priceFreshness.every((source) => source.health !== 'STALE'),
      maxAgeHours,
      priceMaxAgeHours,
      priceStalePercent,
      priceFreshness,
      jobs,
    };
  }

  /** Published, priced, in-stock offers are the prices customers can buy at. */
  private async getPriceFreshness(
    maxAgeHours: number,
    stalePercent: number,
  ): Promise<PriceFreshness[]> {
    const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000);
    const rows = await this.prisma.$queryRaw<FreshnessRow[]>`
      SELECT s.code AS "sourceCode", count(sp.id) AS total,
        count(sp.id) FILTER (WHERE sp."lastSync" < ${cutoff}) AS stale,
        min(sp."lastSync") AS "oldestSync", max(sp."lastSync") AS "newestSync"
      FROM "Source" s
      LEFT JOIN (
        SELECT sp.* FROM "SourceProduct" sp JOIN "Product" p ON p.id = sp."productId"
        WHERE p.status = 'PUBLISHED' AND sp.stock = true AND sp.price > 0
      ) sp ON sp."sourceId" = s.id
      WHERE s.code IN ('th-tools', 'tools-by', 'dukon')
      GROUP BY s.code ORDER BY s.code
    `;
    return rows.map((row) => {
      const total = Number(row.total);
      const stale = Number(row.stale);
      const percent = total ? (stale / total) * 100 : 0;
      return {
        sourceCode: row.sourceCode,
        total,
        stale,
        stalePercent: Number(percent.toFixed(1)),
        oldestSync: row.oldestSync,
        newestSync: row.newestSync,
        health: !total ? 'EMPTY' : percent >= stalePercent ? 'STALE' : 'OK',
      };
    });
  }

  /** Pulls the per-batch counters a parser puts into its run result. */
  private lastBatch(result: unknown) {
    if (!result || typeof result !== 'object') return null;
    const batch = (result as { batch?: unknown }).batch;
    if (!batch || typeof batch !== 'object') return null;

    const { processed, failed } = batch as {
      processed?: unknown;
      failed?: unknown;
    };
    if (typeof processed !== 'number' || typeof failed !== 'number')
      return null;

    return { ...(batch as Record<string, number>), processed, failed };
  }

  private toJson(value: unknown) {
    if (value === undefined) return Prisma.JsonNull;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
