import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ParserRuntimeStatusService } from './parser/parser-runtime-status.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly parserRuntimeStatusService: ParserRuntimeStatusService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health/parser')
  async getParserHealth() {
    const health = await this.parserRuntimeStatusService.getHealth();
    return {
      ok: health.ok,
      maxAgeHours: health.maxAgeHours,
      jobs: health.jobs.map((job) => ({
        key: job.key,
        label: job.label,
        health: job.health,
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
