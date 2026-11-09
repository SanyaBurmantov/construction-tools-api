import { Module } from '@nestjs/common';
import { AiDetectorController } from './ai-detector.controller';
import { AiDetectorCleanupCron } from './ai-detector.cron';
import { AiDetectorService } from './ai-detector.service';
import { UniquenessService } from './uniqueness.service';
import { DetectorClient } from './detector.client';

/**
 * «ИИ-детектор» (`/admin/ai-detector`): the backend half of the `detector`
 * container — fetches a page safely, sends the text, keeps the history.
 * The model itself runs in that container, never in this process.
 */
@Module({
  controllers: [AiDetectorController],
  providers: [
    AiDetectorService,
    DetectorClient,
    UniquenessService,
    AiDetectorCleanupCron,
  ],
  exports: [AiDetectorService, DetectorClient],
})
export class AiDetectorModule {}
