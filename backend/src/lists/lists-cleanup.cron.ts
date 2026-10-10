import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserListsService } from './user-lists.service';

/** Drops list rows older than `LIST_TTL_DAYS` (default 365). */
@Injectable()
export class ListsCleanupCron {
  constructor(private readonly lists: UserListsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handle() {
    await this.lists.purgeStale();
  }
}
