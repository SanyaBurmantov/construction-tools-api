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

  private lastFloorWarning = 0;

  /**
   * False when the paid key's balance is under `AI_MIN_BALANCE` — or cannot
   * be read while a floor is set: a spend cap that fails open is no cap.
   */
  private async aboveFloor() {
    const floor = parseBalanceFloor(process.env.AI_MIN_BALANCE);
    if (!floor) return true;
    const quota = await this.client.quota();
    const amount = balanceFor(quota?.balances ?? null, floor.currency);
    if (amount !== null && amount >= floor.amount) return true;
    if (Date.now() - this.lastFloorWarning > 60 * 60 * 1000) {
      this.lastFloorWarning = Date.now();
      this.logger.warn(
        amount === null
          ? `AI runner stopped: AI_MIN_BALANCE=${process.env.AI_MIN_BALANCE} is set but the balance could not be read`
          : `AI runner stopped: balance ${amount} is under AI_MIN_BALANCE=${process.env.AI_MIN_BALANCE}`,
      );
    }
    return false;
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
        if (!(await this.aboveFloor())) return;
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

/**
 * `AI_MIN_BALANCE`: the floor under which the runner stops — the spend cap of
 * a run is «balance at the start minus what we agreed to spend». «36.4» or
 * «36.4 CNY»; empty or unreadable means no floor.
 */
export function parseBalanceFloor(raw: string | undefined) {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z]{3})?\s*$/.exec(raw ?? '');
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!(amount > 0)) return null;
  return { amount, currency: match[2]?.toUpperCase() ?? null };
}

/**
 * The balance a floor is compared with: the named currency, or — with none
 * named — the one the account actually holds (the largest). DeepSeek lists
 * CNY and USD side by side; adding them up compared yuan with dollars.
 */
export function balanceFor(
  balances: Record<string, number> | null,
  currency: string | null,
) {
  if (!balances) return null;
  if (currency) return balances[currency] ?? null;
  const amounts = Object.values(balances);
  return amounts.length ? Math.max(...amounts) : null;
}
