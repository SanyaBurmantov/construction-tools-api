import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SearchLogService } from './search-log.service';

/** Worker: drops search events past `SEARCH_LOG_TTL_DAYS`. Off the parsing slots. */
@Injectable()
export class SearchLogCleanupCron {
  constructor(private readonly searchLog: SearchLogService) {}

  @Cron('23 4 * * *')
  async handle() {
    await this.searchLog.purgeOld();
  }
}
