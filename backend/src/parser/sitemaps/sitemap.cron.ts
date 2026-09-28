import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { SitemapsService } from './sitemaps.service';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';

@Injectable()
export class SitemapCron {
  private readonly logger = new Logger(SitemapCron.name);
  private isRefreshing = false;

  constructor(
    private readonly sitemapService: SitemapsService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
  ) {}

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_NOON)
  async handleCron() {
    if (process.env.PARSER_CRON_ENABLED !== 'true' || this.isRefreshing) return;

    this.isRefreshing = true;
    await this.runtimeStatus.start(
      'th-tools-refresh',
      'TH-Tools refresh sitemap',
    );
    try {
      await this.sitemapService.parseAllSitemapsThTools();
      await this.runtimeStatus.success('th-tools-refresh');
    } catch (error) {
      // Failure is persisted to runtime status; do NOT rethrow — a thrown cron
      // handler becomes an unhandled rejection that can crash the process.
      await this.runtimeStatus.failure('th-tools-refresh', error);
      this.logger.error(
        'th-tools-refresh cron failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRefreshing = false;
    }
  }
}
