import { Module } from '@nestjs/common';
import { SitemapsService } from './sitemaps.service';
import { SitemapCron } from './sitemap.cron';
import { SitemapController } from './sitemap.controller';
import { AdminGuard } from '../../admin/admin.guard';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';

@Module({
  providers: [
    SitemapsService,
    SitemapCron,
    AdminGuard,
    ParserRuntimeStatusService,
  ],
  controllers: [SitemapController],
})
export class SitemapsModule {}
