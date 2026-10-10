import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { ParserRuntimeStatusService } from './parser/parser-runtime-status.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    private readonly parserRuntimeStatusService: ParserRuntimeStatusService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

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

  @SkipThrottle()
  @Get('health/parser')
  async getParserHealth() {
    const health = await this.parserRuntimeStatusService.getHealth();
    return {
      ok: health.ok,
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
