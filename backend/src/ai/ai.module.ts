import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AiController } from './ai.controller';
import { AiRunnerCron } from './ai-runner.cron';
import { AiService } from './ai.service';
import { AiTemplateTextsService } from './ai-template-texts.service';
import { AiClient } from './ai.client';
import { SeoModule } from '../seo/seo.module';
import { OffersModule } from '../offers/offers.module';
import { AiAssistService } from './assist/ai-assist.service';
import { AiAssistCron } from './assist/ai-assist.cron';
import {
  AiAssistController,
  LandingsController,
} from './assist/ai-assist.controller';

/**
 * Admin AI tasks and the AI assistant (`assist/`): rewrite text fields of picked products/categories with an
 * DeepSeek / OpenRouter model, on a schedule, with a per-item diff and rollback.
 */
@Module({
  imports: [AdminModule, SeoModule, OffersModule],
  controllers: [AiController, AiAssistController, LandingsController],
  providers: [
    AiService,
    AiClient,
    AiRunnerCron,
    AiTemplateTextsService,
    AiAssistService,
    AiAssistCron,
  ],
})
export class AiModule {}
