import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OffersService } from './offers.service';

/**
 * Hourly at :26 (off the parser slots :00/:30, the watchdog :07/:37 and the
 * offer split :x3), at most 200 merges a run. Until 2026-11-23 the auto-merge
 * was only a button in `/admin/duplicates` nobody pressed: b2bit.by joined
 * the catalogue with 381 matches by barcode or brand+sku and merged none of
 * them. ~1 900 groups across all suppliers were waiting; at 200 an hour they
 * are folded within a working day, and a new match within the hour. Worker
 * only, like every cron (`ScheduleModule` is registered there alone).
 */
@Injectable()
export class AutoMergeCron {
  private readonly logger = new Logger(AutoMergeCron.name);
  private running = false;

  constructor(private readonly offers: OffersService) {}

  @Cron('0 26 * * * *')
  async handle() {
    if (this.running) return;
    this.running = true;
    try {
      await this.offers.autoMerge(200);
    } catch (error) {
      this.logger.error(`Auto-merge run failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
