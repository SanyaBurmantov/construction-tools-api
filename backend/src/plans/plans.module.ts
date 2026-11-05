import { Module } from '@nestjs/common';
import { TrafficModule } from '../traffic/traffic.module';
import { PlansAdminController } from './plans.controller';
import { PlansService } from './plans.service';

/** «Планы» — goals and the to-do list of the project (`/admin/plans`). */
@Module({
  imports: [TrafficModule],
  controllers: [PlansAdminController],
  providers: [PlansService],
})
export class PlansModule {}
