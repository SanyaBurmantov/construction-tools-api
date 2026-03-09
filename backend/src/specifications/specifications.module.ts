import { Module } from '@nestjs/common';
import { SpecificationsService } from './specifications.service';
import { SpecificationsController } from './specifications.controller';

@Module({
  providers: [SpecificationsService],
  controllers: [SpecificationsController]
})
export class SpecificationsModule {}
