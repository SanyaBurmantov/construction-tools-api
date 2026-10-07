import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ParserSettingsService } from '../parser-settings.service';
import { ParserJobsService } from '../parser-jobs.service';

const SOURCE_CODE = 'dukon';

/** Scheduled and manual runs share the same job lock and monitoring. */
@Injectable()
export class DukonCron {
  constructor(
    private readonly settings: ParserSettingsService,
    private readonly jobs: ParserJobsService,
  ) {}

  @Cron('0 20,50 * * * *')
  async processPendingQueue() {
    if (!(await this.settings.isSourceCronEnabled(SOURCE_CODE))) return;
    this.jobs.runFromCron(SOURCE_CODE, 'process');
  }

  @Cron('0 0 6 * * *')
  async refreshSitemap() {
    if (!(await this.settings.isSourceCronEnabled(SOURCE_CODE))) return;
    this.jobs.runFromCron(SOURCE_CODE, 'refresh');
  }

  @Cron('0 0 12 1 * *')
  async revalidateMonthly() {
    if (!(await this.settings.isSourceCronEnabled(SOURCE_CODE))) return;
    this.jobs.runFromCron(SOURCE_CODE, 'revalidate');
  }
}
