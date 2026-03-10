import { Module } from '@nestjs/common';
import { SitemapsService } from './sitemaps.service';
import { SitemapCron } from './sitemap.cron';

@Module({
  providers: [SitemapsService, SitemapCron],
})
export class SitemapsModule {}
