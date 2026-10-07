import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ParserSettingsService } from '../parser-settings.service';
import { ParserJobsService } from '../parser-jobs.service';

const SOURCE_CODE = '7745';

/** Scheduled and manual runs share the same job lock and monitoring. */
@Injectable()
export class Supplier7745Cron {
  constructor(
    private readonly settings: ParserSettingsService,
    private readonly jobs: ParserJobsService,
  ) {}

  @Cron('0 25,55 * * * *')
  async processPendingQueue() {
    if (!(await this.settings.isSourceCronEnabled(SOURCE_CODE))) return;
    this.jobs.runFromCron(SOURCE_CODE, 'process');
  }

  @Cron('0 20 6 * * *')
  async refreshSitemap() {
    if (!(await this.settings.isSourceCronEnabled(SOURCE_CODE))) return;
    this.jobs.runFromCron(SOURCE_CODE, 'refresh');
  }
}
