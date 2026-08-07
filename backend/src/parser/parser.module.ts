import { Module } from '@nestjs/common';
import { SitemapsService } from './sitemaps/sitemaps.service';
import { SitemapsModule } from './sitemaps/sitemaps.module';
import { ThToolsCron } from './sites/th-tools.cron';
import { ThToolsParserService } from './sites/th-tools-source.parser';
import { DukonParserService } from './sites/dukon.parser';
import { DukonCron } from './sites/dukon.cron';
import { Supplier7745ParserService } from './sites/7745-source.parser';
import { Supplier7745Cron } from './sites/7745.cron';
import { ToolsByParserService } from './sites/tools-by-source.parser';
import { ToolsByCron } from './sites/tools-by.cron';
import { ParserController } from './parser.controller';
import { ParserAdminController } from './parser-admin.controller';
import { ParserLogService } from './parser-log.service';
import { ParserRuntimeStatusService } from './parser-runtime-status.service';
import { ParserSettingsService } from './parser-settings.service';
import { ProductIdentityService } from './product-identity.service';
import { CategoryQueueService } from './categories/category-queue.service';
import { CategoryTreeService } from './categories/category-tree.service';
import { QueueRecoveryService } from './queue-recovery.service';
import { ParserWatchdogCron } from './parser-watchdog.cron';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminGuard } from '../admin/admin.guard';
import { OffersModule } from '../offers/offers.module';

@Module({
  providers: [
    SitemapsService,
    ThToolsParserService,
    DukonParserService,
    Supplier7745ParserService,
    ToolsByParserService,
    ToolsByCron,
    ThToolsCron,
    DukonCron,
    Supplier7745Cron,
    ParserLogService,
    ParserRuntimeStatusService,
    ParserSettingsService,
    ProductIdentityService,
    QueueRecoveryService,
    ParserWatchdogCron,
    CategoryQueueService,
    CategoryTreeService,
    AdminGuard,
  ],
  imports: [SitemapsModule, OffersModule, NotificationsModule],
  controllers: [ParserController, ParserAdminController],
  // AdminModule consumes these instead of re-providing them: a parser service
  // constructed in two modules means every new dependency has to be registered
  // twice, and forgetting one only shows up as a DI error at boot.
  exports: [
    SitemapsService,
    ThToolsParserService,
    DukonParserService,
    Supplier7745ParserService,
    ToolsByParserService,
    ParserLogService,
    ParserRuntimeStatusService,
    ParserSettingsService,
    ProductIdentityService,
    QueueRecoveryService,
    CategoryQueueService,
    CategoryTreeService,
  ],
})
export class ParserModule {}
