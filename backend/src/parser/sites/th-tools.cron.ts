import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { ThToolsParserService } from './th-tools.parser';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';

const TH_TOOLS_CRON_BATCH_LIMIT = getPositiveEnvNumber(
  'TH_TOOLS_CRON_BATCH_LIMIT',
  30,
);

function getPositiveEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

@Injectable()
export class ThToolsCron {
  private isProcessing = false;

  constructor(
    private readonly thToolsService: ThToolsParserService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron() {
    if (process.env.PARSER_CRON_ENABLED !== 'true' || this.isProcessing) return;

    this.isProcessing = true;
    await this.runtimeStatus.start(
      'th-tools-process',
      'TH-Tools process queue',
    );
    try {
      await this.thToolsService.processSitemapsBatch(
        TH_TOOLS_CRON_BATCH_LIMIT,
        2,
      );
      await this.runtimeStatus.success('th-tools-process');
    } catch (error) {
      await this.runtimeStatus.failure('th-tools-process', error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }
}
