import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { ThToolsParserService } from './th-tools-source.parser';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';
import { ParserSettingsService } from '../parser-settings.service';
import { SitemapsService } from '../sitemaps/sitemaps.service';
import { CategoryQueueService } from '../categories/category-queue.service';

const SOURCE_CODE = 'th-tools';

@Injectable()
export class ThToolsCron {
  private readonly logger = new Logger(ThToolsCron.name);
  private isProcessing = false;
  private isRefreshing = false;
  private isCrawlingCategories = false;

  constructor(
    private readonly thToolsService: ThToolsParserService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
    private readonly settings: ParserSettingsService,
    private readonly sitemaps: SitemapsService,
    private readonly categoryQueue: CategoryQueueService,
  ) {}

  // Slot :00/:30. Sources are staggered so only one parser runs at a time —
  // on a single-core box three of them starting together is what makes runs
  // drag. A new supplier gets its own slot, it does not join this one.
  @Cron('0 0,30 * * * *')
  async processPendingQueue() {
    if (!(await this.isEnabled()) || this.isProcessing) return;

    this.isProcessing = true;
    await this.runtimeStatus.start(
      'th-tools-process',
      'TH-Tools process queue',
    );
    try {
      const result = await this.thToolsService.processSitemapsBatch(
        await this.settings.getBatchLimit(SOURCE_CODE),
        2,
      );
      await this.runtimeStatus.success('th-tools-process', result);
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

  /**
   * Without this the products queue only ever grew by hand — new supplier
   * products never reached it, however long the cron ran.
   */
  @Cron('0 40 6 * * *')
  async refreshSitemap() {
    if (!(await this.isEnabled()) || this.isRefreshing) return;

    this.isRefreshing = true;
    await this.runtimeStatus.start(
      'th-tools-refresh',
      'TH-Tools refresh sitemap',
    );
    try {
      await this.sitemaps.parseAllSitemapsThTools();
      await this.runtimeStatus.success(
        'th-tools-refresh',
        await this.thToolsService.getQueueStats(),
      );
    } catch (error) {
      await this.runtimeStatus.failure('th-tools-refresh', error);
      this.logger.error(
        'th-tools-refresh cron failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRefreshing = false;
    }
  }

  /** Category pages find products the sitemap has not caught up with yet. */
  @Cron('0 5 * * * *')
  async processCategoryQueue() {
    if (!(await this.isEnabled()) || this.isCrawlingCategories) return;

    this.isCrawlingCategories = true;
    await this.runtimeStatus.start(
      'th-tools-categories',
      'TH-Tools crawl categories',
    );
    try {
      const result = await this.categoryQueue.processBatch(SOURCE_CODE, 5);
      await this.runtimeStatus.success('th-tools-categories', result);
    } catch (error) {
      await this.runtimeStatus.failure('th-tools-categories', error);
      this.logger.error(
        'th-tools-categories cron failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isCrawlingCategories = false;
    }
  }

  private isEnabled() {
    return this.settings.isSourceCronEnabled(SOURCE_CODE);
  }
}
