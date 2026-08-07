import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { Supplier7745ParserService } from './7745-source.parser';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';
import { ParserSettingsService } from '../parser-settings.service';

const SOURCE_CODE = '7745';

@Injectable()
export class Supplier7745Cron {
  private readonly logger = new Logger(Supplier7745Cron.name);
  private isProcessing = false;
  private isRefreshing = false;

  constructor(
    private readonly supplier7745Service: Supplier7745ParserService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
    private readonly settings: ParserSettingsService,
  ) {}

  /** Slot :25/:55. Disabled by default — 7745 is a sample site. */
  @Cron('0 25,55 * * * *')
  async processPendingQueue() {
    if (!(await this.isEnabled()) || this.isProcessing) return;

    this.isProcessing = true;
    await this.runtimeStatus.start('7745-process', '7745 process queue');
    try {
      const result = await this.supplier7745Service.processSitemapsBatch(
        await this.settings.getBatchLimit(SOURCE_CODE),
        1,
      );
      await this.runtimeStatus.success('7745-process', result);
    } catch (error) {
      // Failure is persisted to runtime status; do NOT rethrow — a thrown cron
      // handler becomes an unhandled rejection that can crash the process.
      await this.runtimeStatus.failure('7745-process', error);
      this.logger.error(
        '7745-process cron failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isProcessing = false;
    }
  }

  @Cron('0 20 6 * * *')
  async refreshSitemap() {
    if (!(await this.isEnabled()) || this.isRefreshing) return;

    this.isRefreshing = true;
    await this.runtimeStatus.start('7745-refresh', '7745 refresh sitemap');
    try {
      const result = await this.supplier7745Service.refreshSitemaps();
      await this.runtimeStatus.success('7745-refresh', result);
    } catch (error) {
      await this.runtimeStatus.failure('7745-refresh', error);
      this.logger.error(
        '7745-refresh cron failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRefreshing = false;
    }
  }

  private isEnabled() {
    return this.settings.isSourceCronEnabled(SOURCE_CODE);
  }
}
