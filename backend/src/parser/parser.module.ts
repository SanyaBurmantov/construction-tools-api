import { Module } from '@nestjs/common';
import { SitemapsService } from './sitemaps/sitemaps.service';
import { SitemapsModule } from './sitemaps/sitemaps.module';
import { ThToolsCron } from './sites/th-tools.cron';
import { ThToolsParserService } from './sites/th-tools.parser';
import { ParserController } from './parser.controller';
import { ParserLogService } from './parser-log.service';

@Module({
  providers: [
    SitemapsService,
    ThToolsParserService,
    ThToolsCron,
    ParserLogService,
  ],
  imports: [SitemapsModule],
  controllers: [ParserController],
})
export class ParserModule {}
