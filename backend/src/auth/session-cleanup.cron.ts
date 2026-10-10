import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthService } from './auth.service';

/**
 * Expired sessions are also deleted when one is used, but a device that never
 * comes back would leave its row behind forever.
 */
@Injectable()
export class SessionCleanupCron {
  constructor(private readonly auth: AuthService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handle() {
    await this.auth.purgeExpiredSessions();
  }
}
