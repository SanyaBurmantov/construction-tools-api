import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';

/**
 * Expired sessions are also deleted when one is used, but a device that never
 * comes back would leave its row behind forever.
 */
@Injectable()
export class SessionCleanupCron {
  constructor(
    private readonly auth: AuthService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handle() {
    // Independent purges: one failing must not skip the other for a day.
    await Promise.allSettled([
      this.auth.purgeExpiredSessions(),
      this.emailVerification.purgeExpired(),
    ]);
  }
}
