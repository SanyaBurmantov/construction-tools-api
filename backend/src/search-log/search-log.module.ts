import { Module } from '@nestjs/common';
import {
  SearchLogAdminController,
  SearchLogController,
} from './search-log.controller';
import { SearchLogCleanupCron } from './search-log.cron';
import { SearchLogService } from './search-log.service';

/** What visitors search for (`/admin/search` «Поиск»). */
@Module({
  controllers: [SearchLogController, SearchLogAdminController],
  providers: [SearchLogService, SearchLogCleanupCron],
})
export class SearchLogModule {}
