import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TrafficService } from './traffic.service';

/** Worker: drops page views past `TRAFFIC_LOG_TTL_DAYS`. Off the parsing slots. */
@Injectable()
export class TrafficCleanupCron {
  constructor(private readonly traffic: TrafficService) {}

  @Cron('27 4 * * *')
  async handle() {
    await this.traffic.purgeOld();
  }
}
