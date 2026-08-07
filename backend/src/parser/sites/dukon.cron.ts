import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DukonParserService } from './dukon.parser';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';
import { ParserSettingsService } from '../parser-settings.service';

const SOURCE_CODE = 'dukon';

@Injectable()
export class DukonCron {
  private readonly logger = new Logger(DukonCron.name);
  private isProcessing = false;
  private isRefreshing = false;
  private isRevalidating = false;

  constructor(
    private readonly dukonParserService: DukonParserService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
    private readonly settings: ParserSettingsService,
  ) {}

  /** Slot :20/:50 — see the note in th-tools.cron.ts. */
  @Cron('0 20,50 * * * *')
  async processPendingQueue() {
    if (!(await this.isEnabled()) || this.isProcessing) return;

    this.isProcessing = true;
    await this.runtimeStatus.start('dukon-process', 'Dukon process queue');
    try {
      const result = await this.dukonParserService.processSitemapsBatch(
        await this.settings.getBatchLimit(SOURCE_CODE),
        1,
      );
      await this.runtimeStatus.success('dukon-process', result);
    } catch (error) {
      // Failure is persisted to runtime status; do NOT rethrow — a thrown cron
      // handler becomes an unhandled rejection that can crash the process.
      await this.runtimeStatus.failure('dukon-process', error);
      this.logger.error(
        'dukon-process cron failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isProcessing = false;
    }
  }

  @Cron('0 0 6 * * *')
  async refreshSitemap() {
    if (!(await this.isEnabled()) || this.isRefreshing) return;

    this.isRefreshing = true;
    await this.runtimeStatus.start('dukon-refresh', 'Dukon refresh sitemap');
    try {
      const result = await this.dukonParserService.refreshSitemaps();
      await this.runtimeStatus.success('dukon-refresh', result);
    } catch (error) {
      await this.runtimeStatus.failure('dukon-refresh', error);
      this.logger.error(
        'dukon-refresh cron failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRefreshing = false;
    }
  }

  @Cron('0 0 12 1 * *')
  async revalidateMonthly() {
    if (!(await this.isEnabled()) || this.isRevalidating) return;

    this.isRevalidating = true;
    await this.runtimeStatus.start(
      'dukon-revalidate',
      'Dukon monthly revalidation',
    );
    try {
      await this.dukonParserService.refreshSitemaps();
      const result = await this.dukonParserService.revalidateAllSitemaps();
      await this.runtimeStatus.success('dukon-revalidate', result);
    } catch (error) {
      await this.runtimeStatus.failure('dukon-revalidate', error);
      this.logger.error(
        'dukon-revalidate cron failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRevalidating = false;
    }
  }

  private isEnabled() {
    return this.settings.isSourceCronEnabled(SOURCE_CODE);
  }
}
