import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// How many historical ParserRun rows to keep per key. Older rows are pruned
// after each run so the table stays bounded (mirrors ParserLogService).
const MAX_RUNS_PER_KEY = 100;

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
    const statuses = await this.getAll();
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const jobs = statuses.map((status) => {
      const lastSuccessMs = status.lastSuccessAt?.getTime();
      const isStale = !lastSuccessMs || now - lastSuccessMs > maxAgeMs;
      const hasError = Boolean(status.lastError);

      return {
        ...status,
        health: status.isRunning
          ? 'RUNNING'
          : hasError
            ? 'ERROR'
            : isStale
              ? 'STALE'
              : 'OK',
      };
    });

    return {
      ok: jobs.every((job) => job.health === 'OK' || job.health === 'RUNNING'),
      maxAgeHours,
      jobs,
    };
  }

  private toJson(value: unknown) {
    if (value === undefined) return Prisma.JsonNull;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
