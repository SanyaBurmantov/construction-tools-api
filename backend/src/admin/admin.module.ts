import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { SitemapsService } from '../parser/sitemaps/sitemaps.service';
import { ThToolsParserService } from '../parser/sites/th-tools.parser';
import { DukonParserService } from '../parser/sites/dukon.parser';
import { ParserLogService } from '../parser/parser-log.service';

@Module({
  controllers: [AdminController],
  providers: [
    AdminGuard,
    AdminService,
    SitemapsService,
    ThToolsParserService,
    DukonParserService,
    ParserLogService,
  ],
})
export class AdminModule {}
