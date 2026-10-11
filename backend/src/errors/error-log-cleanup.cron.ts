import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ErrorLogService } from './error-log.service';

/** Keeps the error log bounded — `ERROR_LOG_TTL_DAYS`, default 30. */
@Injectable()
export class ErrorLogCleanupCron {
  constructor(private readonly errors: ErrorLogService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handle() {
    await this.errors.purgeStale();
  }
}
