import { Module } from '@nestjs/common';
import { SpecificationsService } from './specifications.service';
import { SpecificationsController } from './specifications.controller';
import { AdminGuard } from '../admin/admin.guard';

@Module({
  providers: [SpecificationsService, AdminGuard],
  controllers: [SpecificationsController],
})
export class SpecificationsModule {}
