import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PARSER_SOURCES } from './parser-settings.service';

/** Give a failed URL this long to be a transient blip before retrying it. */
const RETRY_AFTER_MINUTES = Number(
  process.env.PARSER_RETRY_AFTER_MINUTES ?? 60,
);

/**
 * Attempts beyond which a URL is left alone. `fetchWithTimeout` already retries
 * transient blips inside one attempt, so three failed *runs* means the problem
 * is the page or the parser, and a human has to look.
 */
const REFRESH_AFTER_HOURS = Number(
  process.env.PARSER_REFRESH_AFTER_HOURS ?? 24,
);

const MAX_ATTEMPTS = Number(process.env.PARSER_MAX_ATTEMPTS ?? 3);

/**
 * Puts recoverable FAILED rows back into the queue.
 *
 * Without this, a supplier being down for ten minutes leaves a few hundred URLs
 * stuck as FAILED until somebody notices and presses "Повторить проблемные" —
 * the catalogue quietly stays incomplete in the meantime. SKIPPED rows are
 * never touched: those were skipped on purpose.
 */
@Injectable()
export class QueueRecoveryService {
  private readonly logger = new Logger(QueueRecoveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async requeueRecoverable() {
    const cutoff = new Date(Date.now() - RETRY_AFTER_MINUTES * 60_000);
    const results: Record<string, number> = {};
    const refreshed: Record<string, number> = {};
    const refreshCutoff = new Date(
      Date.now() - REFRESH_AFTER_HOURS * 3_600_000,
    );

    for (const source of PARSER_SOURCES) {
      results[source.code] = await this.requeueSource(source.code, cutoff);
      refreshed[source.code] = await this.requeueSource(
        source.code,
        refreshCutoff,
        true,
      );
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
    return {
      total,
      bySource: results,
      maxAttempts: MAX_ATTEMPTS,
      refreshed,
      categoriesRefreshed: categoriesRefreshed.count,
    };
  }

  private requeueSource(code: string, cutoff: Date, refresh = false) {
    const where = refresh
      ? { status: 'DONE', visitedAt: { lt: cutoff } }
      : {
          status: 'FAILED',
          attempts: { lt: MAX_ATTEMPTS },
          lastTriedAt: { lt: cutoff },
        };
    const data = {
      status: 'PENDING',
      isVisited: false,
      // Keep the last successful date on scheduled refreshes: new URLs go
      // first, then the oldest snapshots. Reset the retry budget for a new cycle.
      ...(refresh ? { attempts: 0, lastError: null } : { visitedAt: null }),
    };

    // Each source has its own queue table, so the delegate is picked explicitly
    // rather than by string — Prisma's types do not survive a dynamic lookup.
    switch (code) {
      case 'th-tools':
        return this.count(
          this.prisma.sitemapsThTools.updateMany({ where, data }),
        );
      case 'tools-by':
        return this.count(
          this.prisma.sitemapsToolsBy.updateMany({ where, data }),
        );
      case 'dukon':
        return this.count(
          this.prisma.sitemapsDukon.updateMany({ where, data }),
        );
      case '7745':
        return this.count(this.prisma.sitemaps7745.updateMany({ where, data }));
      default:
        return Promise.resolve(0);
    }
  }

  private async count(promise: Promise<{ count: number }>) {
    return (await promise).count;
  }
}
