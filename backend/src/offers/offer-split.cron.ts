import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OfferSplitService } from './offer-split.service';

/**
 * Every 10 minutes, 200 cards: the 7.5k collapsed cards found on 2026-11-02
 * are taken apart in about six hours, and one that collapses again is caught
 * within ten minutes. Worker only, like every cron.
 */
@Injectable()
export class OfferSplitCron {
  constructor(private readonly split: OfferSplitService) {}

  @Cron('0 3,13,23,33,43,53 * * * *')
  async handle() {
    await this.split.splitBatch(200);
  }
}
