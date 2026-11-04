import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AiClient } from '../ai.client';
import { balanceFor, parseBalanceFloor } from '../ai-runner.cron';
import { ASSIST_JOB_INFO, ASSIST_JOBS, AssistJob } from './assist-jobs';
import { AiAssistService } from './ai-assist.service';

/**
 * The assistant's scheduler, in the worker: every minute (at :30, off the
 * task runner's :00) one step of one switched-on job — at most one request
 * to the model — round-robin, so no job starves the others. A job with
 * nothing to do rests for its `idleMinutes`; an error rests it for 15 min;
 * `AI_MIN_BALANCE` stops it like it stops the task runner.
 */
@Injectable()
export class AiAssistCron {
  private readonly logger = new Logger(AiAssistCron.name);
  private busy = false;
  private next = 0;
  private readonly restUntil = new Map<AssistJob, number>();

  constructor(
    private readonly assist: AiAssistService,
    private readonly client: AiClient,
  ) {}

  private async aboveFloor() {
    const floor = parseBalanceFloor(process.env.AI_MIN_BALANCE);
    if (!floor) return true;
    const quota = await this.client.quota();
    const amount = balanceFor(quota?.balances ?? null, floor.currency);
    return amount !== null && amount >= floor.amount;
  }

  @Cron('30 * * * * *')
  async tick() {
    if (this.busy || !this.client.enabled) return;
    if (process.env.AI_ASSIST_ENABLED === 'false') return;
    this.busy = true;
    try {
      const now = Date.now();
      for (let i = 0; i < ASSIST_JOBS.length; i++) {
        const job = ASSIST_JOBS[(this.next + i) % ASSIST_JOBS.length];
        if ((this.restUntil.get(job) ?? 0) > now) continue;
        const settings = await this.assist.settings(job);
        if (!settings.enabled) continue;
        if (!(await this.aboveFloor())) return;
        this.next = (this.next + i + 1) % ASSIST_JOBS.length;
        const outcome = await this.assist.step(job);
        const rest =
          outcome.result === 'idle' || outcome.result === 'limit'
            ? ASSIST_JOB_INFO[job].idleMinutes
            : outcome.result === 'error'
              ? 15
              : 0;
        if (rest) this.restUntil.set(job, now + rest * 60_000);
        return;
      }
    } catch (error) {
      this.logger.error(`AI assist failed: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
