import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { ThToolsParserService } from './th-tools.parser';

@Injectable()
export class ThToolsCron {
  constructor(private readonly thToolsService: ThToolsParserService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCron() {
    await this.thToolsService.processSitemapsBatch(1, 1);
  }
}