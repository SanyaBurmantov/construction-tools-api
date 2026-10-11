import { Global, Module } from '@nestjs/common';
import { ErrorLogService } from './error-log.service';
import { ErrorLogCleanupCron } from './error-log-cleanup.cron';

/**
 * The API error log.
 *
 * `@Global()` for the same reason AuthModule is: the exception filter that
 * fills it is registered once for the whole app, and AdminModule serves
 * `GET /admin/errors` from the same service — re-registering it per module
 * would give each one its own dedupe window.
 */
@Global()
@Module({
  providers: [ErrorLogService, ErrorLogCleanupCron],
  exports: [ErrorLogService],
})
export class ErrorsModule {}
