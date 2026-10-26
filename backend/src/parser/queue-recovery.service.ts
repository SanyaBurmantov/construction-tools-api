import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PARSER_SOURCES } from './parser-settings.service';
import { queueTable } from './queue-table';

/** A number from the environment, or the fallback when unset or malformed. */
function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Read on every run, not at module load: a malformed value used to become
 * NaN, an Invalid Date, and a watchdog that threw on every tick.
 */
function recoverySettings() {
  return {
    /** Give a failed URL this long to be a transient blip before retrying. */
    retryAfterMinutes: envNumber('PARSER_RETRY_AFTER_MINUTES', 60),
    /** DONE snapshots older than this are re-read (prices move daily). */
    refreshAfterHours: envNumber('PARSER_REFRESH_AFTER_HOURS', 24),
    /**
     * SKIPPED rows (not a product page, filtered category, 404) are looked at
     * again after this long. Suppliers relist products, fix pages, and admins
     * loosen category filters — none of that used to come back on its own.
     */
    skippedRecheckDays: envNumber('PARSER_SKIPPED_RECHECK_DAYS', 7),
    /**
     * Attempts beyond which a URL is left alone. `fetchWithTimeout` already
     * retries transient blips inside one attempt, so three failed *runs*
     * means the problem is the page or the parser.
     */
    maxAttempts: envNumber('PARSER_MAX_ATTEMPTS', 3),
    /**
     * FAILED rows that used up their attempts get a fresh budget after this
     * long. Three failed runs usually mean a bad page — but th-tool.by was
     * unreachable for eleven days (Oct 2026) and 16k URLs burned all three
     * attempts on "fetch failed"; without this they stayed dead for good.
     */
    failedRecheckDays: envNumber('PARSER_FAILED_RECHECK_DAYS', 3),
  };
}

/** Set on a URL that crashed the process; such a row is never retried. */
const NEVER_FINISHED_ERROR =
  'Разбор этого URL ни разу не завершился (процесс падал или зависал)';

/**
 * Keeps every supplier queue moving without anyone pressing a button:
 *
 * - FAILED rows with attempts left are retried after a pause, and the ones
 *   that used them up get a fresh budget every few days (a supplier outage
 *   fails every URL; it must not leave them dead once the site is back);
 * - DONE rows older than a day are refreshed (that is what re-reads prices);
 * - SKIPPED rows are re-checked weekly, so a relisted product or a loosened
 *   category filter is picked up automatically;
 * - a PENDING row that has used up its attempts without ever finishing — the
 *   URL that crashes the process (OOM) and so never reaches FAILED — is
 *   parked as FAILED instead of sorting first and killing every batch.
 */
@Injectable()
export class QueueRecoveryService {
  private readonly logger = new Logger(QueueRecoveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async requeueRecoverable() {
    const settings = recoverySettings();
    const now = Date.now();
    const retryCutoff = new Date(now - settings.retryAfterMinutes * 60_000);
    const refreshCutoff = new Date(
      now - settings.refreshAfterHours * 3_600_000,
    );
    const skippedCutoff = new Date(
      now - settings.skippedRecheckDays * 86_400_000,
    );
    const failedCutoff = new Date(
      now - settings.failedRecheckDays * 86_400_000,
    );

    const results: Record<string, number> = {};
    const refreshed: Record<string, number> = {};
    const rechecked: Record<string, number> = {};
    const parked: Record<string, number> = {};
    const revived: Record<string, number> = {};

    for (const source of PARSER_SOURCES) {
      const table = queueTable(this.prisma, source.code);
      if (!table) continue;

      parked[source.code] = (
        await table.updateMany({
          where: { status: 'PENDING', attempts: { gte: settings.maxAttempts } },
          data: {
            status: 'FAILED',
            lastError: NEVER_FINISHED_ERROR,
          },
        })
      ).count;

      results[source.code] = (
        await table.updateMany({
          where: {
            status: 'FAILED',
            attempts: { lt: settings.maxAttempts },
            lastTriedAt: { lt: retryCutoff },
          },
          // lastTriedAt cleared: it doubles as the claim lease.
          data: {
            status: 'PENDING',
            isVisited: false,
            visitedAt: null,
            lastTriedAt: null,
          },
        })
      ).count;

      // Exhausted rows, except the ones that crashed the process: retrying
      // those would take the backend down every few days.
      revived[source.code] = (
        await table.updateMany({
          where: {
            status: 'FAILED',
            attempts: { gte: settings.maxAttempts },
            lastTriedAt: { lt: failedCutoff },
            OR: [
              { lastError: null },
              { lastError: { not: NEVER_FINISHED_ERROR } },
            ],
          },
          data: {
            status: 'PENDING',
            isVisited: false,
            attempts: 0,
            lastTriedAt: null,
          },
        })
      ).count;

      // Keep `visitedAt` on refreshes and re-checks: never-seen URLs go first,
      // then the stalest snapshots. A new cycle gets a fresh retry budget.
      refreshed[source.code] = (
        await table.updateMany({
          where: { status: 'DONE', visitedAt: { lt: refreshCutoff } },
          data: {
            status: 'PENDING',
            isVisited: false,
            attempts: 0,
            lastError: null,
          },
        })
      ).count;

      rechecked[source.code] = (
        await table.updateMany({
          where: { status: 'SKIPPED', visitedAt: { lt: skippedCutoff } },
          data: {
            status: 'PENDING',
            isVisited: false,
            attempts: 0,
            lastError: null,
          },
        })
      ).count;
    }

    const categoriesRefreshed =
      await this.prisma.parserCategoryQueue.updateMany({
        where: {
          sourceCode: 'th-tools',
          status: 'DONE',
          isEnabled: true,
          visitedAt: { lt: refreshCutoff },
        },
        data: { status: 'PENDING', attempts: 0, lastError: null },
      });

    const total = Object.values(results).reduce((sum, n) => sum + n, 0);
    if (total) {
      this.logger.log(
        `Requeued ${total} recoverable URLs: ${JSON.stringify(results)}`,
      );
    }
    const parkedTotal = Object.values(parked).reduce((sum, n) => sum + n, 0);
    if (parkedTotal) {
      this.logger.warn(
        `Parked ${parkedTotal} URLs that never finished parsing: ${JSON.stringify(parked)}`,
      );
    }
    return {
      total,
      bySource: results,
      maxAttempts: settings.maxAttempts,
      refreshed,
      rechecked,
      parked,
      revived,
      categoriesRefreshed: categoriesRefreshed.count,
    };
  }
}
