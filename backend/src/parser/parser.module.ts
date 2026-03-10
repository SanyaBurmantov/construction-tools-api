import { Module } from '@nestjs/common';
import { SitemapsService } from './sitemaps/sitemaps.service';
import { SitemapsModule } from './sitemaps/sitemaps.module';
import { ThToolsCron } from './sites/th-tools.cron';
import { ThToolsParserService } from './sites/th-tools.parser';

@Module({
  providers: [SitemapsService, ThToolsParserService, ThToolsCron],
  imports: [SitemapsModule]
})
export class ParserModule {}
