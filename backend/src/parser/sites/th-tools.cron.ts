import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { ThToolsParserService } from './th-tools.parser';

@Injectable()
export class ThToolsCron {
  constructor(private readonly thToolsService: ThToolsParserService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron() {
    await this.thToolsService.processSitemapsBatch();
  }
}