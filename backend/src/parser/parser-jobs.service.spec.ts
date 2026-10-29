import { ParserJobsService } from './parser-jobs.service';
import { ParserRuntimeStatusService } from './parser-runtime-status.service';
import { ParserSettingsService } from './parser-settings.service';

function createService(
  run: () => Promise<unknown>,
  processRun: () => Promise<unknown> = run,
) {
  const started: string[] = [];
  const finished: string[] = [];

  const runtimeStatus = {
    start: jest.fn((key: string) => {
      started.push(key);
      return Promise.resolve();
    }),
    success: jest.fn((key: string) => {
      finished.push(`ok:${key}`);
      return Promise.resolve();
    }),
    failure: jest.fn((key: string) => {
      finished.push(`fail:${key}`);
      return Promise.resolve();
    }),
    markWaiting: jest.fn(() => Promise.resolve()),
  } as unknown as ParserRuntimeStatusService;

  const settings = {
    getBatchLimit: jest.fn(() => Promise.resolve(30)),
  } as unknown as ParserSettingsService;

  const toolsBy = {
    refreshSitemaps: run,
    processSitemapsBatch: processRun,
    revalidateAllSitemaps: run,
  };
  const service = new ParserJobsService(
    runtimeStatus,
    settings,
    {} as never,
    {} as never,
    {} as never,
    toolsBy as never,
    {} as never,
  );

  return { service, started, finished };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('ParserJobsService', () => {
  it('returns immediately instead of waiting for a long crawl', async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = createService(() => blocked);

    // If start() awaited the job, this expectation could not run at all.
    expect(service.start('tools-by', 'refresh')).toEqual({
      started: true,
      key: 'tools-by-refresh',
    });
    expect(service.isRunning('tools-by-refresh')).toBe(true);

    release();
    await flush();
  });

  it('refuses a second run of a job already in flight', async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = createService(() => blocked);

    service.start('tools-by', 'refresh');
    expect(service.start('tools-by', 'refresh')).toEqual({
      started: false,
      key: 'tools-by-refresh',
      reason: 'already-running',
    });

    release();
    await flush();
  });

  it('frees the lock once the job finishes', async () => {
    const { service, finished } = createService(() => Promise.resolve('done'));

    service.start('tools-by', 'refresh');
    await flush();

    expect(finished).toEqual(['ok:tools-by-refresh']);
    expect(service.isRunning('tools-by-refresh')).toBe(false);
  });

  it('queues a daily refresh instead of skipping it when a batch holds the source', async () => {
    let releaseProcess: () => void = () => {};
    const processBlocked = new Promise<void>((resolve) => {
      releaseProcess = resolve;
    });
    const refreshRun = jest.fn(() => Promise.resolve('crawled'));
    const { service, started, finished } = createService(
      refreshRun,
      () => processBlocked,
    );

    service.start('tools-by', 'process');
    expect(service.isRunning('tools-by-process')).toBe(true);

    expect(
      service.runFromCron('tools-by', 'refresh', { waitForLock: true }),
    ).toEqual({ started: true, key: 'tools-by-refresh' });
    expect(refreshRun).not.toHaveBeenCalled();
    expect(started).toEqual(['tools-by-process']);

    // A second cron tick while the first refresh is waiting must not queue it
    // twice or start a parallel crawl.
    expect(
      service.runFromCron('tools-by', 'refresh', { waitForLock: true }),
    ).toEqual({
      started: false,
      key: 'tools-by-refresh',
      reason: 'already-running',
    });

    releaseProcess();
    await flush();
    await flush();

    expect(refreshRun).toHaveBeenCalledTimes(1);
    expect(finished).toEqual(['ok:tools-by-process', 'ok:tools-by-refresh']);
  });

  it('frees a queued refresh when the blocking batch fails', async () => {
    let rejectProcess: (error: Error) => void = () => {};
    const processBlocked = new Promise<void>((_, reject) => {
      rejectProcess = reject;
    });
    const refreshRun = jest.fn(() => Promise.resolve('crawled'));
    const { service, finished } = createService(
      refreshRun,
      () => processBlocked,
    );

    service.start('tools-by', 'process');
    service.runFromCron('tools-by', 'refresh', { waitForLock: true });

    rejectProcess(new Error('supplier down'));
    await flush();
    await flush();

    expect(refreshRun).toHaveBeenCalledTimes(1);
    expect(finished).toEqual(['fail:tools-by-process', 'ok:tools-by-refresh']);
  });

  // Two queued jobs of one source must run one after the other. Each used to
  // count the other as busy, so both waited forever and, being pending, kept
  // every later slot of the source skipped until a restart.
  it('runs two queued jobs of one source in order instead of deadlocking', async () => {
    let releaseProcess: () => void = () => {};
    const processBlocked = new Promise<void>((resolve) => {
      releaseProcess = resolve;
    });
    const { service, finished } = createService(
      () => Promise.resolve('done'),
      () => processBlocked,
    );

    service.start('tools-by', 'process');
    service.runFromCron('tools-by', 'refresh', { waitForLock: true });
    service.runFromCron('tools-by', 'revalidate', { waitForLock: true });
    expect(service.isWaiting('tools-by-refresh')).toBe(true);
    expect(service.isWaiting('tools-by-revalidate')).toBe(true);

    releaseProcess();
    for (let i = 0; i < 5; i++) await flush();

    expect(finished).toEqual([
      'ok:tools-by-process',
      'ok:tools-by-refresh',
      'ok:tools-by-revalidate',
    ]);
    expect(service.isWaiting('tools-by-revalidate')).toBe(false);
  });

  it('records a failure and still frees the lock', async () => {
    const { service, finished } = createService(() =>
      Promise.reject(new Error('supplier down')),
    );

    service.start('tools-by', 'refresh');
    await flush();

    expect(finished).toEqual(['fail:tools-by-refresh']);
    expect(service.isRunning('tools-by-refresh')).toBe(false);
  });

  it('rejects a job the source does not have', () => {
    const { service } = createService(() => Promise.resolve());

    expect(service.start('tools-by', 'categories')).toEqual({
      started: false,
      key: 'tools-by-categories',
      reason: 'unknown-job',
    });
  });

  it('lists tools.by jobs with the crawl first', () => {
    const { service } = createService(() => Promise.resolve());

    expect(service.jobsFor('tools-by').map((job) => job.name)).toEqual([
      'refresh',
      'process',
      'revalidate',
    ]);
  });

  describe('admin requests (runRequested)', () => {
    it('resolves with the result once the job has run', async () => {
      const { service } = createService(() =>
        Promise.resolve({ processed: 3 }),
      );

      await expect(
        service.runRequested('tools-by', 'refresh'),
      ).resolves.toEqual({ ok: true, result: { processed: 3 } });
      expect(service.isRunning('tools-by-refresh')).toBe(false);
    });

    it('resolves with the error instead of rejecting', async () => {
      const { service, finished } = createService(() =>
        Promise.reject(new Error('supplier down')),
      );

      await expect(
        service.runRequested('tools-by', 'refresh'),
      ).resolves.toEqual({ ok: false, error: 'supplier down' });
      expect(finished).toEqual(['fail:tools-by-refresh']);
    });

    it('queues behind a running batch and marks itself waiting', async () => {
      let release: () => void = () => {};
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { service, finished } = createService(
        () => Promise.resolve('crawled'),
        () => blocked,
      );

      service.start('tools-by', 'process');
      const outcome = service.runRequested('tools-by', 'refresh');
      await flush();

      expect(service.isWaiting('tools-by-refresh')).toBe(true);
      expect(finished).toEqual([]);

      release();
      await expect(outcome).resolves.toEqual({ ok: true, result: 'crawled' });
      expect(finished).toEqual(['ok:tools-by-process', 'ok:tools-by-refresh']);
    });

    it('refuses a request for a job already in flight', async () => {
      let release: () => void = () => {};
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { service } = createService(() => blocked);

      service.start('tools-by', 'refresh');
      await expect(
        service.runRequested('tools-by', 'refresh'),
      ).resolves.toEqual({
        ok: false,
        error: 'Задание tools-by-refresh уже выполняется',
      });

      release();
      await flush();
    });

    it('passes a manual batch size through, one URL at a time', async () => {
      const processSitemapsBatch = jest.fn(() => Promise.resolve({}));
      const service = new ParserJobsService(
        {
          start: () => Promise.resolve(),
          success: () => Promise.resolve(),
        } as never,
        { getBatchLimit: () => Promise.resolve(300) } as never,
        {} as never,
        {} as never,
        {} as never,
        { processSitemapsBatch } as never,
        {} as never,
      );

      await service.runRequested('tools-by', 'process', { limit: 25 });
      expect(processSitemapsBatch).toHaveBeenLastCalledWith(25, 1);

      await service.runRequested('tools-by', 'process');
      expect(processSitemapsBatch).toHaveBeenLastCalledWith(300, 1);
    });
  });

  describe('th-tools refresh', () => {
    it('reports the sitemap and the category pass separately', async () => {
      const sitemapResult = {
        urlsInSitemap: 41_000,
        productUrls: 39_465,
        queuedNow: 0,
      };
      const categoryResult = { seen: 716, added: 0 };

      const sitemaps = {
        parseAllSitemapsThTools: jest.fn(() => Promise.resolve(sitemapResult)),
      };
      const categoryQueue = { refresh: jest.fn(() => categoryResult) };

      const service = new ParserJobsService(
        {} as never,
        {} as never,
        sitemaps as never,
        categoryQueue as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const refresh = service
        .jobsFor('th-tools')
        .find((job) => job.name === 'refresh')!;

      // The job used to return the category refresh alone, so the admin showed
      // `{"seen": 716, "added": 0}` — the size of the category queue — and the
      // sitemap looked broken when it was simply never counted.
      await expect(refresh.run()).resolves.toEqual({
        sitemap: sitemapResult,
        categories: categoryResult,
      });
      expect(sitemaps.parseAllSitemapsThTools).toHaveBeenCalled();
    });

    it('crawls as many categories as the settings allow', async () => {
      const processBatch = jest.fn(() => Promise.resolve({}));
      const service = new ParserJobsService(
        {} as never,
        { getCategoryBatchLimit: () => Promise.resolve(20) } as never,
        {} as never,
        { processBatch } as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const categories = service
        .jobsFor('th-tools')
        .find((job) => job.name === 'categories')!;
      await categories.run();

      expect(processBatch).toHaveBeenCalledWith('th-tools', 20);
    });
  });
});
