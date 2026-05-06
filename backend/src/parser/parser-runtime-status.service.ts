import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ParserRuntimeStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async start(key: string, label: string) {
    await this.prisma.parserRuntimeStatus.upsert({
      where: { key },
      update: {
        label,
        isRunning: true,
        startedAt: new Date(),
        finishedAt: null,
        lastError: null,
        runs: { increment: 1 },
      },
      create: {
        key,
        label,
        isRunning: true,
        startedAt: new Date(),
        runs: 1,
      },
    });
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
  }

  async failure(key: string, error: unknown) {
    const now = new Date();
    await this.prisma.parserRuntimeStatus.upsert({
      where: { key },
      update: {
        isRunning: false,
        finishedAt: now,
        lastErrorAt: now,
        lastError: error instanceof Error ? error.message : String(error),
        failures: { increment: 1 },
      },
      create: {
        key,
        label: key,
        isRunning: false,
        finishedAt: now,
        lastErrorAt: now,
        lastError: error instanceof Error ? error.message : String(error),
        runs: 1,
        failures: 1,
      },
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
}
