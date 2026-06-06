import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DukonParserService } from './dukon.parser';
import { ParserRuntimeStatusService } from '../parser-runtime-status.service';

const DUKON_CRON_BATCH_LIMIT = getPositiveEnvNumber(
  'DUKON_CRON_BATCH_LIMIT',
  30,
);

function getPositiveEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

@Injectable()
export class DukonCron {
  private isProcessing = false;
  private isRefreshing = false;
  private isRevalidating = false;

  constructor(
    private readonly dukonParserService: DukonParserService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
  ) {}

  @Cron('0 */30 * * * *')
  async processPendingQueue() {
    if (!this.isEnabled() || this.isProcessing) return;

    this.isProcessing = true;
    await this.runtimeStatus.start('dukon-process', 'Dukon process queue');
    try {
      const result = await this.dukonParserService.processSitemapsBatch(
        DUKON_CRON_BATCH_LIMIT,
        1,
      );
      await this.runtimeStatus.success('dukon-process', result);
    } catch (error) {
      await this.runtimeStatus.failure('dukon-process', error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  @Cron('0 0 6 * * *')
  async refreshSitemap() {
    if (!this.isEnabled() || this.isRefreshing) return;

    this.isRefreshing = true;
    await this.runtimeStatus.start('dukon-refresh', 'Dukon refresh sitemap');
    try {
      const result = await this.dukonParserService.refreshSitemaps();
      await this.runtimeStatus.success('dukon-refresh', result);
    } catch (error) {
      await this.runtimeStatus.failure('dukon-refresh', error);
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }

  @Cron('0 0 12 1 * *')
  async revalidateMonthly() {
    if (!this.isEnabled() || this.isRevalidating) return;

    this.isRevalidating = true;
    await this.runtimeStatus.start(
      'dukon-revalidate',
      'Dukon monthly revalidation',
    );
    try {
      await this.dukonParserService.refreshSitemaps();
      const result = await this.dukonParserService.revalidateAllSitemaps();
      await this.runtimeStatus.success('dukon-revalidate', result);
    } catch (error) {
      await this.runtimeStatus.failure('dukon-revalidate', error);
      throw error;
    } finally {
      this.isRevalidating = false;
    }
  }

  private isEnabled() {
    return process.env.PARSER_CRON_ENABLED === 'true';
  }
}
