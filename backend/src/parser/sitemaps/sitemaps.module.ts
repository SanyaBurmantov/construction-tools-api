import { Module } from '@nestjs/common';
import { SitemapsService } from './sitemaps.service';
import { SitemapController } from './sitemap.controller';
import { AdminGuard } from '../../admin/admin.guard';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';

@Module({
  providers: [SitemapsService, AdminGuard, ParserRuntimeStatusService],
  controllers: [SitemapController],
})
export class SitemapsModule {}
