import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { ParserRuntimeStatusService } from './parser-runtime-status.service';
import { ParserSettingsService } from './parser-settings.service';
import { QueueRecoveryService } from './queue-recovery.service';
import { TelegramService } from '../notifications/telegram.service';

@Injectable()
export class ParserWatchdogCron {
  private readonly logger = new Logger(ParserWatchdogCron.name);
  private isRunning = false;

  /**
   * Jobs we have already alerted about. An unhealthy parser stays unhealthy
   * until someone fixes it — without this the operator would get the same
   * message every 15 minutes and start ignoring the channel.
   */
  private readonly alerted = new Set<string>();

  constructor(
    private readonly runtimeStatus: ParserRuntimeStatusService,
    private readonly settings: ParserSettingsService,
    private readonly recovery: QueueRecoveryService,
    private readonly telegram: TelegramService,
  ) {}

  /** Off-slot on purpose: every source has a parsing slot on the :00/:10/:20 grid. */
  @Cron('0 7,37 * * * *')
  async watch() {
    if (!(await this.settings.isCronEnabled()) || this.isRunning) return;

    this.isRunning = true;
    try {
      const requeued = await this.recovery.requeueRecoverable();
      await this.checkHealth();

      if (requeued.total) {
        this.logger.log(`Watchdog requeued ${requeued.total} URLs`);
      }
    } catch (error) {
      // A watchdog that crashes the process would be worse than no watchdog.
      this.logger.error(
        'parser watchdog failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async checkHealth() {
    const health = await this.runtimeStatus.getHealth();

    for (const job of health.jobs) {
      const broken = job.health === 'ERROR';

      if (!broken) {
        // Recovered: forget it, so the next real breakage alerts again.
        this.alerted.delete(job.key);
        continue;
      }
      if (this.alerted.has(job.key)) continue;

      this.alerted.add(job.key);
      await this.telegram.notifyParserProblem({
        key: job.key,
        label: job.label,
        reason: this.describe(job),
      });
    }
  }

  private describe(job: {
    lastError: string | null;
    failureRate?: number | null;
    lastBatch?: { processed: number; failed: number } | null;
  }) {
    if (job.lastBatch && job.failureRate) {
      return `${job.lastBatch.failed} из ${job.lastBatch.processed} URL с ошибкой (${Math.round(job.failureRate * 100)}%)`;
    }
    return job.lastError ?? 'неизвестная ошибка';
  }
}
