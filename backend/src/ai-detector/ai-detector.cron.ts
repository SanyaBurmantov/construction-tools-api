import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AiDetectorService } from './ai-detector.service';

/** Worker: drops detector checks past `AI_DETECTOR_TTL_DAYS` (365). */
@Injectable()
export class AiDetectorCleanupCron {
  constructor(private readonly detector: AiDetectorService) {}

  @Cron('29 4 * * *')
  async handle() {
    await this.detector.purgeOld();
  }
}
