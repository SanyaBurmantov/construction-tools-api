import { Module } from '@nestjs/common';
import {
  TrafficAdminController,
  TrafficController,
} from './traffic.controller';
import { TrafficCleanupCron } from './traffic.cron';
import { TrafficService } from './traffic.service';

/** The site's own visit statistics and 404 journal (`/admin/traffic`). */
@Module({
  controllers: [TrafficController, TrafficAdminController],
  providers: [TrafficService, TrafficCleanupCron],
})
export class TrafficModule {}
