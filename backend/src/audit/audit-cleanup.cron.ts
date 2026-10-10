import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdminActionLogService } from './admin-action-log.service';

/** Keeps the audit trail bounded — `ADMIN_LOG_TTL_DAYS`, default 180. */
@Injectable()
export class AuditCleanupCron {
  constructor(private readonly log: AdminActionLogService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handle() {
    await this.log.purgeStale();
  }
}
