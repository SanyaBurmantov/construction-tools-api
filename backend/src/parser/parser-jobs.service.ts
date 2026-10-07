import { Injectable, Logger } from '@nestjs/common';
import { ParserRuntimeStatusService } from './parser-runtime-status.service';
import { CategoryQueueService } from './categories/category-queue.service';
import {
  ParserSettingsService,
  getParserSource,
} from './parser-settings.service';
import { SitemapsService } from './sitemaps/sitemaps.service';
import { ThToolsParserService } from './sites/th-tools-source.parser';
import { ToolsByParserService } from './sites/tools-by-source.parser';
import { DukonParserService } from './sites/dukon.parser';
import { Supplier7745ParserService } from './sites/7745-source.parser';

export type ParserJob = {
  /** Suffix after the source code; the runtime status key is `<code>-<name>`. */
  name: string;
  label: string;
  description: string;
  run: () => Promise<unknown>;
};

export type JobRunResult =
  | { started: true; key: string }
  | { started: false; key: string; reason: 'already-running' | 'unknown-job' };

/**
 * One place that knows how to start a parser job, whether the trigger is a cron
 * or an admin pressing a button.
 *
 * Two reasons it exists rather than each cron owning its own logic:
 * a **shared "already running" guard** — the crons' private booleans could not
 * see a manual run, so a button press during a scheduled batch would have run
 * the same queue twice — and **fire-and-forget execution**, because a tools.by
 * catalog crawl takes ~15 minutes and no HTTP request may wait that long.
 */
@Injectable()
export class ParserJobsService {
  private readonly logger = new Logger(ParserJobsService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly runtimeStatus: ParserRuntimeStatusService,
    private readonly settings: ParserSettingsService,
    private readonly sitemaps: SitemapsService,
    private readonly categoryQueue: CategoryQueueService,
    private readonly thTools: ThToolsParserService,
    private readonly toolsBy: ToolsByParserService,
    private readonly dukon: DukonParserService,
    private readonly supplier7745: Supplier7745ParserService,
  ) {}

  /** Jobs a source has, in the order they make sense to an operator. */
  jobsFor(code: string): ParserJob[] {
    switch (code) {
      case 'th-tools':
        return [
          {
            name: 'refresh',
            label: 'Загрузить sitemap',
            description:
              'Читает sitemap поставщика и добавляет новые товары в очередь.',
            run: async () => {
              await this.sitemaps.parseAllSitemapsThTools();
              return this.categoryQueue.refresh(code);
            },
          },
          {
            name: 'categories',
            label: 'Обойти категории',
            description:
              'Идёт по страницам категорий и находит товары, которых нет в sitemap.',
            run: () => this.categoryQueue.processBatch(code, 5),
          },
          {
            name: 'process',
            label: 'Разобрать пачку',
            description: 'Берёт из очереди пачку URL и сохраняет товары.',
            run: async () =>
              this.thTools.processSitemapsBatch(
                await this.settings.getBatchLimit(code),
                2,
              ),
          },
          {
            name: 'revalidate',
            label: 'Перечитать всё',
            description:
              'Возвращает всю очередь в PENDING. Нужно после правок парсера — например, чтобы вернуть товары, потерянные из-за старой ошибки со слагами. Разбор займёт столько же, сколько первый залив.',
            run: () => this.thTools.revalidateAllSitemaps(),
          },
        ];
      case 'tools-by':
        return [
          {
            name: 'refresh',
            label: 'Обойти каталог',
            description:
              'У tools.by нет sitemap: обход каталога — единственный способ найти новые товары. Идёт долго.',
            run: () => this.toolsBy.refreshSitemaps(),
          },
          {
            name: 'process',
            label: 'Разобрать пачку',
            description: 'Берёт из очереди пачку URL и сохраняет товары.',
            run: async () =>
              this.toolsBy.processSitemapsBatch(
                await this.settings.getBatchLimit(code),
                1,
              ),
          },
          {
            name: 'revalidate',
            label: 'Перечитать всё',
            description:
              'Возвращает всю очередь в PENDING. Нужно после правок парсера — например, чтобы вернуть товары, потерянные из-за старой ошибки со слагами. Разбор займёт столько же, сколько первый залив.',
            run: () => this.toolsBy.revalidateAllSitemaps(),
          },
        ];
      case 'dukon':
        return [
          {
            name: 'refresh',
            label: 'Загрузить sitemap',
            description: 'Sitemap плюс обход всех разделов каталога.',
            run: () => this.dukon.refreshSitemaps(),
          },
          {
            name: 'process',
            label: 'Разобрать пачку',
            description: 'Берёт из очереди пачку URL и сохраняет товары.',
            run: async () =>
              this.dukon.processSitemapsBatch(
                await this.settings.getBatchLimit(code),
                1,
              ),
          },
          {
            name: 'revalidate',
            label: 'Перечитать всё',
            description:
              'Возвращает всю очередь в PENDING и перечитывает каталог заново.',
            run: () => this.dukon.revalidateAllSitemaps(),
          },
        ];
      case '7745':
        return [
          {
            name: 'refresh',
            label: 'Загрузить sitemap',
            description: 'Пример-источник, включать не нужно.',
            run: () => this.supplier7745.refreshSitemaps(),
          },
          {
            name: 'process',
            label: 'Разобрать пачку',
            description: 'Пример-источник, включать не нужно.',
            run: async () =>
              this.supplier7745.processSitemapsBatch(
                await this.settings.getBatchLimit(code),
                1,
              ),
          },
        ];
      default:
        return [];
    }
  }

  isRunning(key: string) {
    return this.running.has(key);
  }

  /**
   * Starts a job and returns immediately. Progress and the outcome land in
   * `ParserRuntimeStatus`, which the admin already polls — a crawl that takes
   * a quarter of an hour cannot be an HTTP round-trip.
   */
  start(code: string, jobName: string): JobRunResult {
    const key = `${code}-${jobName}`;
    const job = this.jobsFor(code).find((item) => item.name === jobName);

    if (!job || !getParserSource(code)) {
      return { started: false, key, reason: 'unknown-job' };
    }
    if (this.running.has(key)) {
      return { started: false, key, reason: 'already-running' };
    }

    this.running.add(key);
    // Deliberately not awaited. The catch is mandatory: an unhandled rejection
    // here would take the whole process down.
    void this.execute(key, job).catch((error) => {
      this.logger.error(
        `${key} crashed outside its own error handling`,
        error instanceof Error ? error.stack : String(error),
      );
    });

    return { started: true, key };
  }

  private async execute(key: string, job: ParserJob) {
    await this.runtimeStatus.start(key, job.label);
    try {
      const result = await job.run();
      await this.runtimeStatus.success(key, result);
    } catch (error) {
      await this.runtimeStatus.failure(key, error);
      this.logger.error(
        `${key} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running.delete(key);
    }
  }

  /**
   * Cron entry point. Same guard, so a scheduled run and a button press can
   * never process the same queue at the same time.
   */
  runFromCron(code: string, jobName: string) {
    return this.start(code, jobName);
  }
}
