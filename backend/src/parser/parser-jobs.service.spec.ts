import { ParserJobsService } from './parser-jobs.service';
import { ParserRuntimeStatusService } from './parser-runtime-status.service';
import { ParserSettingsService } from './parser-settings.service';

function createService(run: () => Promise<unknown>) {
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
  } as unknown as ParserRuntimeStatusService;

  const settings = {
    getBatchLimit: jest.fn(() => Promise.resolve(30)),
  } as unknown as ParserSettingsService;

  const toolsBy = { refreshSitemaps: run, processSitemapsBatch: run };
  const service = new ParserJobsService(
    runtimeStatus,
    settings,
    {} as never,
    {} as never,
    {} as never,
    toolsBy as never,
    {} as never,
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
});
