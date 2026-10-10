import { Module } from '@nestjs/common';
import { AdminActionLogService } from './admin-action-log.service';
import { AuditCleanupCron } from './audit-cleanup.cron';

/**
 * The admin audit trail. The interceptor that fills it is registered globally
 * in AppModule (it has to see every controller); AdminModule imports this to
 * serve `GET /admin/audit`.
 */
@Module({
  providers: [AdminActionLogService, AuditCleanupCron],
  exports: [AdminActionLogService],
})
export class AuditModule {}
