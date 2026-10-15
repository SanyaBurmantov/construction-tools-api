import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AiController } from './ai.controller';
import { AiRunnerCron } from './ai-runner.cron';
import { AiService } from './ai.service';
import { OpenRouterClient } from './openrouter.client';

/**
 * Admin AI tasks: rewrite text fields of picked products/categories with an
 * OpenRouter model, on a schedule, with a per-item diff and rollback.
 */
@Module({
  imports: [AdminModule],
  controllers: [AiController],
  providers: [AiService, OpenRouterClient, AiRunnerCron],
})
export class AiModule {}
