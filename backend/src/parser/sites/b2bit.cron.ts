import { Cron } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { ParserSettingsService } from '../parser-settings.service';
import { ParserJobsService } from '../parser-jobs.service';

const SOURCE_CODE = 'b2bit';

/**
 * Schedules only; the work, the lock and the runtime status live in
 * ParserJobsService. Slots are the free ones: th-tools :00/:30, its
 * categories :05, watchdog :07/:37, tools-by :10/:40, dukon :20/:50.
 */
@Injectable()
export class B2bitCron {
  constructor(
    private readonly settings: ParserSettingsService,
    private readonly jobs: ParserJobsService,
  ) {}

  @Cron('0 15,45 * * * *')
  async processPendingQueue() {
    if (!(await this.isEnabled())) return;
    this.jobs.runFromCron(SOURCE_CODE, 'process');
  }

  /**
   * The category listings are the only way new products reach the queue
   * (~150 requests). Daily, between tools.by (05:20) and dukon (06:00); it
   * waits for a running batch instead of skipping the day.
   */
  @Cron('0 40 5 * * *')
  async refreshCatalog() {
    if (!(await this.isEnabled())) return;
    this.jobs.runFromCron(SOURCE_CODE, 'refresh', { waitForLock: true });
  }

  /** Like the other suppliers: a full re-read once a month. */
  @Cron('0 45 12 1 * *')
  async revalidateMonthly() {
    if (!(await this.isEnabled())) return;
    this.jobs.runFromCron(SOURCE_CODE, 'revalidate');
  }

  private isEnabled() {
    return this.settings.isSourceCronEnabled(SOURCE_CODE);
  }
}
