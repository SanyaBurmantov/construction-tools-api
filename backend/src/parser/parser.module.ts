import { Module } from '@nestjs/common';
import { ParserService } from './parser.service';
import { ParserJobService } from './parser-job.service';
import { ParserController } from './parser.controller';
import { PlaywrightService } from './playwright.service';
import { SitemapService } from './sitemap.service';
import { ParserJobQueueService } from './parser-job-queue.service';
import { SourceWebsitesModule } from '../source-websites/source-websites.module';
import { ProductsModule } from '../products/products.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    SourceWebsitesModule,
    ProductsModule,
    CategoriesModule,
  ],
  controllers: [ParserController],
  providers: [ParserService, ParserJobService, PlaywrightService, SitemapService, ParserJobQueueService],
  exports: [ParserService, ParserJobService, PlaywrightService, SitemapService, ParserJobQueueService],
})
export class ParserModule {}
