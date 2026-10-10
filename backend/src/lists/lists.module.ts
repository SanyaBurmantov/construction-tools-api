import { Module } from '@nestjs/common';
import { ListsController } from './lists.controller';
import { UserListsService } from './user-lists.service';
import { ListsCleanupCron } from './lists-cleanup.cron';

@Module({
  controllers: [ListsController],
  providers: [UserListsService, ListsCleanupCron],
  exports: [UserListsService],
})
export class ListsModule {}
