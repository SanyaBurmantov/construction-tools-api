import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(ThToolsCron.name);
  private isProcessing = false;

  constructor(
    private readonly thToolsService: ThToolsParserService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
  ) {}

  @Cron('0 */5 * * * *')
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
      // Failure is persisted to runtime status; do NOT rethrow — a thrown cron
      // handler becomes an unhandled rejection that can crash the process.
      await this.runtimeStatus.failure('th-tools-process', error);
      this.logger.error(
        'th-tools-process cron failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isProcessing = false;
    }
  }
}
