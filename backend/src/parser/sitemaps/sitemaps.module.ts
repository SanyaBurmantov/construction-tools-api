import { Module } from '@nestjs/common';
import { SitemapsService } from './sitemaps.service';
import { SitemapCron } from './sitemap.cron';
import { SitemapController } from './sitemap.controller';

@Module({
  providers: [SitemapsService, SitemapCron],
  controllers: [SitemapController],
})
export class SitemapsModule {}
