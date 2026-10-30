import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AiController } from './ai.controller';
import { AiRunnerCron } from './ai-runner.cron';
import { AiService } from './ai.service';
import { AiTemplateTextsService } from './ai-template-texts.service';
import { AiClient } from './ai.client';
import { SeoModule } from '../seo/seo.module';

/**
 * Admin AI tasks: rewrite text fields of picked products/categories with an
 * DeepSeek / OpenRouter model, on a schedule, with a per-item diff and rollback.
 */
@Module({
  imports: [AdminModule, SeoModule],
  controllers: [AiController],
  providers: [AiService, AiClient, AiRunnerCron, AiTemplateTextsService],
})
export class AiModule {}
