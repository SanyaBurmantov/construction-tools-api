import { Module } from '@nestjs/common';
import { SitemapsService } from './sitemaps/sitemaps.service';
import { SitemapsModule } from './sitemaps/sitemaps.module';
import { ThToolsCron } from './sites/th-tools.cron';
import { ThToolsParserService } from './sites/th-tools.parser';
import { DukonParserService } from './sites/dukon.parser';
import { DukonCron } from './sites/dukon.cron';
import { Supplier7745ParserService } from './sites/7745-source.parser';
import { Supplier7745Cron } from './sites/7745.cron';
import { ToolsByParserService } from './sites/tools-by-source.parser';
import { ParserController } from './parser.controller';
import { ParserLogService } from './parser-log.service';
import { ParserRuntimeStatusService } from './parser-runtime-status.service';
import { AdminGuard } from '../admin/admin.guard';
import { OffersModule } from '../offers/offers.module';

@Module({
  providers: [
    SitemapsService,
    ThToolsParserService,
    DukonParserService,
    Supplier7745ParserService,
    ToolsByParserService,
    ThToolsCron,
    DukonCron,
    Supplier7745Cron,
    ParserLogService,
    ParserRuntimeStatusService,
    AdminGuard,
  ],
  imports: [SitemapsModule, OffersModule],
  controllers: [ParserController],
})
export class ParserModule {}
