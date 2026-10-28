import {
  Controller,
  Get,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from './prisma/prisma.service';
import { ParserRuntimeStatusService } from './parser/parser-runtime-status.service';
import { AdminGuard } from './admin/admin.guard';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parserRuntimeStatusService: ParserRuntimeStatusService,
  ) {}

  // Liveness: the process is up. Used by the container healthcheck.
  @SkipThrottle()
  @Get('health')
  getHealth() {
    return { status: 'ok' };
  }

  // Readiness: dependencies (the DB) are reachable. 503 if not.
  @SkipThrottle()
  @Get('health/ready')
  async getReadiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not-ready' });
    }
  }

  // Admin-only: it names our suppliers, their offer counts, queue sizes and
  // job failures — "which supplier carries what" is internal. Monitoring
  // calls it with `x-admin-token`; container healthchecks use /health/ready.
  @SkipThrottle()
  @UseGuards(AdminGuard)
  @Get('health/parser')
  async getParserHealth() {
    const health = await this.parserRuntimeStatusService.getHealth();
    return {
      ok: health.ok,
      worker: health.worker,
      maxAgeHours: health.maxAgeHours,
      priceMaxAgeHours: health.priceMaxAgeHours,
      priceStalePercent: health.priceStalePercent,
      priceFreshness: health.priceFreshness,
      // Without this an exhausted queue is indistinguishable from a healthy
      // one: the batch job still runs, finds nothing and reports SUCCESS.
      queues: health.queues,
      jobs: health.jobs.map((job) => ({
        key: job.key,
        label: job.label,
        health: job.health,
        maxAgeHours: job.maxAgeHours,
        isRunning: job.isRunning,
        lastSuccessAt: job.lastSuccessAt,
        lastErrorAt: job.lastErrorAt,
        runs: job.runs,
        successes: job.successes,
        failures: job.failures,
      })),
    };
  }
}
