import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { ToolsByParserService } from './tools-by-source.parser';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';
import { ParserSettingsService } from '../parser-settings.service';

const SOURCE_CODE = 'tools-by';

@Injectable()
export class ToolsByCron {
  private readonly logger = new Logger(ToolsByCron.name);
  private isProcessing = false;
  private isRefreshing = false;

  constructor(
    private readonly toolsByService: ToolsByParserService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
    private readonly settings: ParserSettingsService,
  ) {}

  /** Slot :10/:40 — see the note in th-tools.cron.ts. */
  @Cron('0 10,40 * * * *')
  async processPendingQueue() {
    if (!(await this.isEnabled()) || this.isProcessing) return;

    this.isProcessing = true;
    await this.runtimeStatus.start(
      'tools-by-process',
      'Tools.by process queue',
    );
    try {
      const result = await this.toolsByService.processSitemapsBatch(
        await this.settings.getBatchLimit(SOURCE_CODE),
        1,
      );
      await this.runtimeStatus.success('tools-by-process', result);
    } catch (error) {
      // Failure is persisted to runtime status; do NOT rethrow — a thrown cron
      // handler becomes an unhandled rejection that can crash the process.
      await this.runtimeStatus.failure('tools-by-process', error);
      this.logger.error(
        'tools-by-process cron failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * tools.by publishes no sitemap.xml, so "refresh" is a catalog crawl — it is
   * both the category discovery and the only way new products reach the queue.
   * Scheduled away from the other sources' slots: on a small box the crawl and
   * a product batch competing for the single core is what makes runs drag.
   */
  @Cron('0 20 5 * * *')
  async refreshCatalog() {
    if (!(await this.isEnabled()) || this.isRefreshing) return;

    this.isRefreshing = true;
    await this.runtimeStatus.start(
      'tools-by-refresh',
      'Tools.by crawl catalog',
    );
    try {
      const result = await this.toolsByService.refreshSitemaps();
      await this.runtimeStatus.success('tools-by-refresh', result);
    } catch (error) {
      await this.runtimeStatus.failure('tools-by-refresh', error);
      this.logger.error(
        'tools-by-refresh cron failed',
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
