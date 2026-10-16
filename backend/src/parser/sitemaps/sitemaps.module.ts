import { Module } from '@nestjs/common';
import { SitemapsService } from './sitemaps.service';
import { AdminGuard } from '../../admin/admin.guard';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';

@Module({
  providers: [SitemapsService, AdminGuard, ParserRuntimeStatusService],
})
export class SitemapsModule {}
