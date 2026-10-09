import { Cron } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { ParserSettingsService } from '../parser-settings.service';
import { ParserJobsService } from '../parser-jobs.service';

const SOURCE_CODE = 'tools-by';

/**
 * Schedules only. The work, the runtime status and the "is it already running"
 * guard all live in ParserJobsService, so a scheduled run and a button press in
 * /admin/parsing can never process the same queue at once.
 */
@Injectable()
export class ToolsByCron {
  constructor(
    private readonly settings: ParserSettingsService,
    private readonly jobs: ParserJobsService,
  ) {}

  /** Slot :10/:40 — see the note in th-tools.cron.ts. */
  @Cron('0 10,40 * * * *')
  async processPendingQueue() {
    if (!(await this.isEnabled())) return;
    this.jobs.runFromCron(SOURCE_CODE, 'process');
  }

  /**
   * tools.by publishes no sitemap.xml, so "refresh" is a catalog crawl — it is
   * both the category discovery and the only way new products reach the queue.
   * Scheduled away from the other sources' slots: on a small box the crawl and
   * a product batch competing for the single core is what makes runs drag.
   */
  @Cron('0 20 5 * * *')
  async refreshCatalog() {
    if (!(await this.isEnabled())) return;
    this.jobs.runFromCron(SOURCE_CODE, 'refresh');
  }

  /** Periodically refresh prices even when discovery finds no new URLs. */
  @Cron('0 30 12 1 * *')
  async revalidateMonthly() {
    if (!(await this.isEnabled())) return;
    this.jobs.runFromCron(SOURCE_CODE, 'revalidate');
  }

  private isEnabled() {
    return this.settings.isSourceCronEnabled(SOURCE_CODE);
  }
}
