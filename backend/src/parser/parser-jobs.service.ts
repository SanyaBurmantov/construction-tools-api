import { ConflictException, Injectable, Logger } from '@nestjs/common';
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

/** What an admin request may pass to a job. */
export type JobParams = {
  /** A manual batch size; a manual batch also runs one URL at a time. */
  limit?: number;
};

export type ParserJob = {
  /** Suffix after the source code; the runtime status key is `<code>-<name>`. */
  name: string;
  label: string;
  description: string;
  /** Run by an endpoint of its own, not listed as a button on the jobs panel. */
  hidden?: boolean;
  run: (params?: JobParams) => Promise<unknown>;
};

/** How a job ended, for whoever asked for it (an admin request). */
export type JobOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export type JobRunResult =
  | { started: true; key: string }
  | { started: false; key: string; reason: 'already-running' | 'unknown-job' };

export type CronRunOptions = {
  /**
   * Wait for the source's current job to finish instead of skipping the slot.
   * Used by the daily catalogue crawls: a 300-product batch starts at :50 and
   * can still be running at :00, which used to make every daily refresh a
   * no-op (`start()` answered `already-running`).
   */
  waitForLock?: boolean;
};

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
  /** Cron jobs waiting for the source lock; they count as busy for later slots. */
  private readonly pending = new Set<string>();
  /** Wake-ups keyed by source code, resolved whenever one of its jobs ends. */
  private readonly waiters = new Map<string, Array<() => void>>();

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
            // Both halves are reported, keyed by what they are. The job used to
            // return only the category refresh, so the admin showed
            // `{"seen": 716, "added": 0}` — 716 being the category queue — and
            // the sitemap looked dead when it was simply never counted.
            run: async () => {
              const sitemap = await this.sitemaps.parseAllSitemapsThTools();
              const categories = await this.categoryQueue.refresh(code);
              return { sitemap, categories };
            },
          },
          {
            name: 'categories',
            label: 'Обойти категории',
            description:
              'Идёт по страницам категорий и находит товары, которых нет в sitemap.',
            run: async (params) =>
              this.categoryQueue.processBatch(
                code,
                params?.limit ??
                  (await this.settings.getCategoryBatchLimit(code)),
              ),
          },
          {
            name: 'categories-refresh',
            label: 'Пополнить очередь категорий',
            description: 'Читает категории из sitemap поставщика.',
            hidden: true,
            run: () => this.categoryQueue.refresh(code),
          },
          {
            name: 'process',
            label: 'Разобрать пачку',
            description: 'Берёт из очереди пачку URL и сохраняет товары.',
            run: async (params) =>
              params?.limit
                ? this.thTools.processSitemapsBatch(params.limit, 1)
                : this.thTools.processSitemapsBatch(
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
            run: async (params) =>
              this.toolsBy.processSitemapsBatch(
                params?.limit ?? (await this.settings.getBatchLimit(code)),
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
            label: 'Обойти каталог и бренды',
            description:
              'Sitemap поставщика устарел: новые товары находятся обходом дерева каталога и страниц брендов (по 15 товаров на страницу). Обход возобновляется с места остановки.',
            run: () => this.dukon.refreshSitemaps(),
          },
          {
            name: 'process',
            label: 'Разобрать пачку',
            description: 'Берёт из очереди пачку URL и сохраняет товары.',
            run: async (params) =>
              this.dukon.processSitemapsBatch(
                params?.limit ?? (await this.settings.getBatchLimit(code)),
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
            run: async (params) =>
              this.supplier7745.processSitemapsBatch(
                params?.limit ?? (await this.settings.getBatchLimit(code)),
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

  /** A cron job queued behind the source lock (see `startWhenFree`). */
  isWaiting(key: string) {
    return this.pending.has(key);
  }

  /**
   * The job of this source that is running now, if any. Jobs of one source
   * share one lock: «concurrency 1 per supplier» is the politeness rule, and
   * th-tools' category crawl (:05) used to hit the shop at the same time as
   * a product batch (:00/:30) that ran long.
   */
  private busyKey(code: string, ignoreKey?: string): string | undefined {
    for (const key of this.running) {
      if (key !== ignoreKey && key.startsWith(`${code}-`)) return key;
    }
    for (const key of this.pending) {
      if (key !== ignoreKey && key.startsWith(`${code}-`)) return key;
    }
    return undefined;
  }

  /**
   * Whether a queued job may take the source now: nothing of the source is
   * running and no job queued before it is still waiting. Checking `busyKey`
   * here instead would make two queued jobs of one source wait for each other
   * forever — and, being pending, block every later slot of that source too.
   * `pending` is a Set, so iteration order is queue order.
   */
  private isTurnOf(code: string, key: string) {
    for (const running of this.running) {
      if (running.startsWith(`${code}-`)) return false;
    }
    for (const queued of this.pending) {
      if (queued === key) return true;
      if (queued.startsWith(`${code}-`)) return false;
    }
    return true;
  }

  /** A finished job may be what the queued refresh was waiting for. */
  private notifySourceFree(code: string) {
    const waiters = this.waiters.get(code);
    if (!waiters) return;
    this.waiters.delete(code);
    for (const wake of waiters) wake();
  }

  private begin(
    code: string,
    key: string,
    job: ParserJob,
    params?: JobParams,
  ): Promise<JobOutcome> {
    this.running.add(key);
    // Callers do not await it. The catch is mandatory: an unhandled rejection
    // here would take the whole process down.
    return this.execute(code, key, job, params).catch((error: unknown) => {
      this.logger.error(
        `${key} crashed outside its own error handling`,
        error instanceof Error ? error.stack : String(error),
      );
      return { ok: false, error: errorMessage(error) } as const;
    });
  }

  /**
   * Synchronous variant for the legacy `/admin/queue/*` buttons, which wait
   * for their batch. Same per-source lock as `start()` — they used to call
   * the services directly and run alongside a cron batch on the same rows.
   */
  async runExclusive<T>(
    code: string,
    jobName: string,
    label: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const key = `${code}-${jobName}`;
    const busy = this.busyKey(code);
    if (busy) {
      throw new ConflictException(
        `Сейчас выполняется задание ${busy} — дождитесь его окончания`,
      );
    }
    this.running.add(key);
    try {
      await this.runtimeStatus.start(key, label);
      const result = await run();
      await this.runtimeStatus.success(key, result).catch(() => undefined);
      return result;
    } catch (error) {
      await this.runtimeStatus.failure(key, error).catch(() => undefined);
      throw error;
    } finally {
      this.running.delete(key);
      this.notifySourceFree(code);
    }
  }

  /**
   * Starts a job and returns immediately. Progress and the outcome land in
   * `ParserRuntimeStatus`, which the admin already polls — a crawl that takes
   * a quarter of an hour cannot be an HTTP round-trip.
   */
  start(code: string, jobName: string, params?: JobParams): JobRunResult {
    const key = `${code}-${jobName}`;
    const job = this.findJob(code, jobName);

    if (!job) {
      return { started: false, key, reason: 'unknown-job' };
    }
    const busy = this.busyKey(code);
    if (busy) {
      return { started: false, key: busy, reason: 'already-running' };
    }

    void this.begin(code, key, job, params);
    return { started: true, key };
  }

  findJob(code: string, jobName: string): ParserJob | undefined {
    if (!getParserSource(code)) return undefined;
    return this.jobsFor(code).find((item) => item.name === jobName);
  }

  /**
   * An admin request handed over by the API (`ParserJobRequestService`): it
   * queues behind the source lock like a waiting cron job, in arrival order,
   * and resolves with the outcome once the job has run.
   */
  runRequested(
    code: string,
    jobName: string,
    params?: JobParams,
  ): Promise<JobOutcome> {
    const key = `${code}-${jobName}`;
    const job = this.findJob(code, jobName);
    if (!job) {
      return Promise.resolve({ ok: false, error: `Unknown job ${key}` });
    }
    if (this.running.has(key) || this.pending.has(key)) {
      return Promise.resolve({
        ok: false,
        error: `Задание ${key} уже выполняется`,
      });
    }
    if (!this.busyKey(code)) return this.begin(code, key, job, params);
    return this.enqueue(code, key, job, params);
  }

  /**
   * Starts a cron job, optionally waiting for the source instead of skipping.
   *
   * The pending entry counts as busy immediately, so the next process slot
   * cannot start while the refresh is waiting — otherwise the batch could take
   * the lock again and the refresh would wait another 30 minutes.
   */
  private startWhenFree(code: string, jobName: string): JobRunResult {
    const key = `${code}-${jobName}`;
    const job = this.findJob(code, jobName);

    if (!job) {
      return { started: false, key, reason: 'unknown-job' };
    }
    if (this.running.has(key) || this.pending.has(key)) {
      return { started: false, key, reason: 'already-running' };
    }
    if (!this.busyKey(code)) return this.start(code, jobName);

    void this.enqueue(code, key, job);
    return { started: true, key };
  }

  /** Queues a job behind the source lock; resolves once it has run. */
  private enqueue(
    code: string,
    key: string,
    job: ParserJob,
    params?: JobParams,
  ): Promise<JobOutcome> {
    this.pending.add(key);
    this.logger.log(`${key}: waiting for ${this.busyKey(code, key)} to finish`);
    void this.runtimeStatus.markWaiting(key, job.label, true);
    return this.waitThenRun(code, key, job, params);
  }

  private async waitThenRun(
    code: string,
    key: string,
    job: ParserJob,
    params?: JobParams,
  ): Promise<JobOutcome> {
    try {
      while (!this.isTurnOf(code, key)) {
        await new Promise<void>((resolve) => {
          const waiters = this.waiters.get(code) ?? [];
          waiters.push(resolve);
          this.waiters.set(code, waiters);
        });
      }
    } catch (error) {
      this.pending.delete(key);
      void this.runtimeStatus.markWaiting(key, job.label, false);
      this.logger.error(
        `${key} crashed while waiting for the source lock`,
        error instanceof Error ? error.stack : String(error),
      );
      return { ok: false, error: errorMessage(error) };
    }

    // No await between the re-check and `begin`, so no cron slot can steal the
    // source between the waiter waking up and the refresh taking the lock.
    // (`runtimeStatus.start` clears the waiting mark.)
    this.pending.delete(key);
    return this.begin(code, key, job, params);
  }

  private async execute(
    code: string,
    key: string,
    job: ParserJob,
    params?: JobParams,
  ): Promise<JobOutcome> {
    try {
      // Inside the try: a DB blip here used to skip the `finally`, leaving the
      // key in `running` and the job answering "already-running" on every slot
      // until the process restarted.
      await this.runtimeStatus.start(key, job.label);
      const result = await job.run(params);
      await this.runtimeStatus.success(key, result);
      return { ok: true, result };
    } catch (error) {
      await this.runtimeStatus.failure(key, error).catch(() => undefined);
      this.logger.error(
        `${key} failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return { ok: false, error: errorMessage(error) };
    } finally {
      this.running.delete(key);
      this.notifySourceFree(code);
    }
  }

  /**
   * Cron entry point. Same guard, so a scheduled run and a button press can
   * never process the same queue at the same time.
   */
  runFromCron(code: string, jobName: string, options: CronRunOptions = {}) {
    if (options.waitForLock) return this.startWhenFree(code, jobName);
    const result = this.start(code, jobName);
    if (!result.started && result.reason === 'already-running') {
      // Visible on purpose: a slot skipped every time is the first sign that
      // a batch outgrew its 30-minute window.
      this.logger.log(
        `${code}-${jobName}: slot skipped, ${result.key} is still running`,
      );
    }
    return result;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
