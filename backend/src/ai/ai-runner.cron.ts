import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AiService } from './ai.service';
import { AiClient } from './ai.client';

/**
 * The scheduler. Every minute it takes the earliest due task and runs a few
 * batches of it; one task at a time, one request at a time — the free tier
 * is a daily request count, so parallelism would only reach the 429 sooner.
 *
 * Re-reads the task between batches, so a pause or cancel from the admin
 * takes effect after the batch in flight.
 */
@Injectable()
export class AiRunnerCron {
  private readonly logger = new Logger(AiRunnerCron.name);
  private busy = false;

  constructor(
    private readonly ai: AiService,
    private readonly client: AiClient,
  ) {}

  private get batchesPerTick() {
    const value = Number(process.env.AI_BATCHES_PER_TICK ?? 3);
    return Number.isFinite(value) && value > 0 ? value : 3;
  }

  @Cron('0 * * * * *')
  async tick() {
    if (this.busy || !this.client.enabled) return;
    if (process.env.AI_RUNNER_ENABLED === 'false') return;
    this.busy = true;
    try {
      for (let i = 0; i < this.batchesPerTick; i++) {
        const task = await this.ai.nextRunnableTask();
        if (!task) return;
        const outcome = await this.ai.runBatch(task);
        // An error usually repeats (bad model id, provider down): one wasted
        // request per tick is enough, not AI_BATCHES_PER_TICK of the 50/day.
        if (outcome === 'rate-limited' || outcome === 'error') return;
      }
    } catch (error) {
      this.logger.error(`AI runner failed: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
