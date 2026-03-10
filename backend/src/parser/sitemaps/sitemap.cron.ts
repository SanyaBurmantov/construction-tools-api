import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { SitemapsService } from './sitemaps.service';

@Injectable()
export class SitemapCron {
  constructor(private readonly sitemapService: SitemapsService) {}

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_NOON)
  async handleCron() {
    await this.sitemapService.parseAllSitemapsThTools();
  }
}