import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiClient } from './ai.client';
import { balanceFor, parseBalanceFloor } from './ai-runner.cron';

/** The admin's floor; no row = the env value (the old place). */
export const MIN_BALANCE_KEY = 'ai.minBalance';

export type BalanceFloorSetting = {
  /** What is in force: «20 CNY», «36.4», or '' for no floor. */
  value: string;
  /** Where it comes from: set in the admin, the env fallback, or nothing. */
  source: 'admin' | 'env' | 'none';
  /** `AI_MIN_BALANCE` as deployed — what a reset goes back to. */
  env: string;
};

/**
 * The spend cap of the AI runner and the assistant: under this balance both
 * stop. It used to be `AI_MIN_BALANCE` only, so changing a budget meant
 * editing `.env.prod` and recreating two containers (owner, 2026-11-12:
 * «вынеси из енвов в админку»). Now `SiteSetting ai.minBalance` → env → none,
 * read on every check — the next runner tick obeys a change, no restart.
 * An empty admin value is an explicit «no floor»; a reset removes the row
 * and the env value applies again.
 */
@Injectable()
export class AiBalanceFloorService {
  private readonly logger = new Logger(AiBalanceFloorService.name);
  private lastWarning = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: AiClient,
  ) {}

  private get envValue() {
    return (process.env.AI_MIN_BALANCE ?? '').trim();
  }

  async setting(): Promise<BalanceFloorSetting> {
    const env = this.envValue;
    const row = await this.prisma.siteSetting.findUnique({
      where: { key: MIN_BALANCE_KEY },
    });
    if (row) return { value: row.value, source: 'admin', env };
    return { value: env, source: env ? 'env' : 'none', env };
  }

  /** `null` = back to the env value; '' = no floor at all. */
  async set(raw: string | null): Promise<BalanceFloorSetting> {
    if (raw === null) {
      await this.prisma.siteSetting.deleteMany({
        where: { key: MIN_BALANCE_KEY },
      });
      return this.setting();
    }
    const value = raw.trim().replace(/\s+/g, ' ');
    if (value && !parseBalanceFloor(value)) {
      throw new BadRequestException(
        'Порог — число и, по желанию, валюта: «20», «20 CNY», «3 USD». Пусто — без порога.',
      );
    }
    await this.prisma.siteSetting.upsert({
      where: { key: MIN_BALANCE_KEY },
      create: { key: MIN_BALANCE_KEY, value },
      update: { value },
    });
    return this.setting();
  }

  /**
   * False when the paid key's balance is under the floor — or cannot be read
   * while a floor is set: a spend cap that fails open is no cap.
   * `label` names the caller in the (hourly) warning.
   */
  async aboveFloor(label: string): Promise<boolean> {
    const { value, source } = await this.setting();
    const floor = parseBalanceFloor(value);
    if (!floor) return true;
    const quota = await this.client.quota();
    const amount = balanceFor(quota?.balances ?? null, floor.currency);
    if (amount !== null && amount >= floor.amount) return true;
    if (Date.now() - this.lastWarning > 60 * 60 * 1000) {
      this.lastWarning = Date.now();
      const where = source === 'admin' ? 'admin' : 'AI_MIN_BALANCE';
      this.logger.warn(
        amount === null
          ? `${label} stopped: a balance floor (${value}, ${where}) is set but the balance could not be read`
          : `${label} stopped: balance ${amount} is under the floor ${value} (${where})`,
      );
    }
    return false;
  }
}
