import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { OptionalAuthGuard } from './optional-auth.guard';
import { UsersAdminService } from './users-admin.service';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { SessionCleanupCron } from './session-cleanup.cron';

/**
 * Global on purpose: `AdminGuard` now resolves admin sessions through
 * `AuthService`, and that guard is instantiated in five different modules
 * (admin, parser, sitemaps, specifications, catalog-normalizer). Exporting
 * globally keeps those module lists unchanged instead of re-registering the
 * same stateless service — or importing AdminModule, which would be circular.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    OptionalAuthGuard,
    UsersAdminService,
    AdminBootstrapService,
    SessionCleanupCron,
  ],
  exports: [AuthService, AuthGuard, OptionalAuthGuard, UsersAdminService],
})
export class AuthModule {}
