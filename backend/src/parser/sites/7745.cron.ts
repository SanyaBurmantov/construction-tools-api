import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { Supplier7745ParserService } from './7745-source.parser';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';

const SUPPLIER_7745_CRON_BATCH_LIMIT = getPositiveEnvNumber(
  'SUPPLIER_7745_CRON_BATCH_LIMIT',
  30,
);

function getPositiveEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

@Injectable()
export class Supplier7745Cron {
  private isProcessing = false;
  private isRefreshing = false;

  constructor(
    private readonly supplier7745Service: Supplier7745ParserService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async processPendingQueue() {
    if (!this.isEnabled() || this.isProcessing) return;

    this.isProcessing = true;
    await this.runtimeStatus.start('7745-process', '7745 process queue');
    try {
      const result = await this.supplier7745Service.processSitemapsBatch(
        SUPPLIER_7745_CRON_BATCH_LIMIT,
        1,
      );
      await this.runtimeStatus.success('7745-process', result);
    } catch (error) {
      await this.runtimeStatus.failure('7745-process', error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  @Cron('0 20 6 * * *')
  async refreshSitemap() {
    if (!this.isEnabled() || this.isRefreshing) return;

    this.isRefreshing = true;
    await this.runtimeStatus.start('7745-refresh', '7745 refresh sitemap');
    try {
      const result = await this.supplier7745Service.refreshSitemaps();
      await this.runtimeStatus.success('7745-refresh', result);
    } catch (error) {
      await this.runtimeStatus.failure('7745-refresh', error);
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }

  private isEnabled() {
    return (
      process.env.PARSER_CRON_ENABLED === 'true' &&
      process.env.SUPPLIER_7745_CRON_ENABLED === 'true'
    );
  }
}
