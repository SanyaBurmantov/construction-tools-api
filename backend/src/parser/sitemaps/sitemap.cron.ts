import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { SitemapsService } from './sitemaps.service';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';

@Injectable()
export class SitemapCron {
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
      await this.runtimeStatus.failure('th-tools-refresh', error);
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }
}
