import { ParserRuntimeStatusService } from './parser-runtime-status.service';
import { PrismaService } from '../prisma/prisma.service';

const MINUTE = 60_000;

function serviceWith(rows: unknown[], freshness: unknown[] = []) {
  const prisma = {
    parserRuntimeStatus: { findMany: jest.fn(() => Promise.resolve(rows)) },
    $queryRaw: jest.fn(() => Promise.resolve(freshness)),
  } as unknown as PrismaService;
  return new ParserRuntimeStatusService(prisma);
}

const job = (overrides: Record<string, unknown> = {}) => ({
  key: 'th-tools-process',
  label: 'TH-Tools process queue',
  isRunning: false,
  startedAt: new Date(),
  finishedAt: new Date(),
  lastSuccessAt: new Date(Date.now() - MINUTE),
  lastErrorAt: null,
  lastError: null,
  lastResult: null,
  runs: 10,
  successes: 10,
  failures: 0,
  ...overrides,
});

describe('parser health', () => {
  it('is OK for a recent successful run', async () => {
    const health = await serviceWith([
      job({ lastResult: { batch: { processed: 300, failed: 2 } } }),
    ]).getHealth();

    expect(health.jobs[0].health).toBe('OK');
    expect(health.ok).toBe(true);
  });

  it('is ERROR when most of the batch failed, even though the run succeeded', async () => {
    // The silent death: the cron finishes fine, the catalogue stops growing.
    const health = await serviceWith([
      job({ lastResult: { batch: { processed: 300, failed: 280 } } }),
    ]).getHealth();

    expect(health.jobs[0].health).toBe('ERROR');
    expect(health.jobs[0].failureRate).toBeCloseTo(0.933, 2);
    expect(health.ok).toBe(false);
  });

  it('ignores the rate on a batch too small to mean anything', async () => {
    const health = await serviceWith([
      job({ lastResult: { batch: { processed: 2, failed: 2 } } }),
    ]).getHealth();

    expect(health.jobs[0].health).toBe('OK');
  });

  it('still reports staleness when no batch counters are present', async () => {
    const health = await serviceWith([
      job({ lastSuccessAt: new Date(Date.now() - 5 * 60 * MINUTE) }),
    ]).getHealth();

    expect(health.jobs[0].health).toBe('STALE');
    expect(health.jobs[0].failureRate).toBeNull();
  });

  it('survives a run result that is not batch-shaped', async () => {
    const health = await serviceWith([
      job({ lastResult: { queued: 5, visited: 1 } }),
    ]).getHealth();

    expect(health.jobs[0].health).toBe('OK');
    expect(health.jobs[0].lastBatch).toBeNull();
  });

  it('keeps a hard failure as ERROR regardless of counters', async () => {
    const health = await serviceWith([
      job({ lastError: 'ECONNREFUSED', lastErrorAt: new Date() }),
    ]).getHealth();

    expect(health.jobs[0].health).toBe('ERROR');
  });
  it('reports frozen prices despite successful empty process runs', async () => {
    const health = await serviceWith(
      [
        job({
          key: 'tools-by-process',
          lastResult: { batch: { processed: 0, failed: 0 } },
        }),
      ],
      [
        {
          sourceCode: 'tools-by',
          total: 5303n,
          stale: 5303n,
          oldestSync: new Date('2026-10-01'),
          newestSync: new Date('2026-10-01'),
        },
      ],
    ).getHealth();
    expect(health.jobs[0].health).toBe('OK');
    expect(health.priceFreshness[0]).toMatchObject({
      total: 5303,
      stale: 5303,
      stalePercent: 100,
      health: 'STALE',
    });
    expect(health.ok).toBe(false);
  });

  it('does not hide an old portion of prices behind one newly synchronized offer', async () => {
    const health = await serviceWith(
      [job()],
      [
        {
          sourceCode: 'dukon',
          total: 100n,
          stale: 90n,
          oldestSync: new Date('2026-10-01'),
          newestSync: new Date(),
        },
      ],
    ).getHealth();
    expect(health.priceFreshness[0].health).toBe('STALE');
    expect(health.ok).toBe(false);
  });

  it('keeps a small stale tail visible below the alert threshold and handles empty sources', async () => {
    const health = await serviceWith(
      [job()],
      [
        {
          sourceCode: 'dukon',
          total: 100n,
          stale: 1n,
          oldestSync: new Date('2026-10-01'),
          newestSync: new Date(),
        },
        {
          sourceCode: 'tools-by',
          total: 0n,
          stale: 0n,
          oldestSync: null,
          newestSync: null,
        },
      ],
    ).getHealth();
    expect(health.priceFreshness).toEqual([
      expect.objectContaining({ stale: 1, stalePercent: 1, health: 'OK' }),
      expect.objectContaining({ total: 0, health: 'EMPTY' }),
    ]);
    expect(health.ok).toBe(true);
  });

  it('uses the configured age and stale percentage, including the exact threshold', async () => {
    const saved = {
      age: process.env.PARSER_PRICE_MAX_AGE_HOURS,
      percent: process.env.PARSER_PRICE_STALE_PERCENT,
    };
    try {
      process.env.PARSER_PRICE_MAX_AGE_HOURS = '72';
      process.env.PARSER_PRICE_STALE_PERCENT = '20';
      const health = await serviceWith(
        [],
        [
          {
            sourceCode: 'dukon',
            total: 100n,
            stale: 20n,
            oldestSync: null,
            newestSync: null,
          },
        ],
      ).getHealth();
      expect(health).toMatchObject({
        priceMaxAgeHours: 72,
        priceStalePercent: 20,
        ok: false,
      });
    } finally {
      if (saved.age === undefined)
        delete process.env.PARSER_PRICE_MAX_AGE_HOURS;
      else process.env.PARSER_PRICE_MAX_AGE_HOURS = saved.age;
      if (saved.percent === undefined)
        delete process.env.PARSER_PRICE_STALE_PERCENT;
      else process.env.PARSER_PRICE_STALE_PERCENT = saved.percent;
    }
  });

  it('gives daily and monthly jobs their scheduling interval while retaining process staleness', async () => {
    const health = await serviceWith([
      job({
        key: 'tools-by-refresh',
        lastSuccessAt: new Date(Date.now() - 20 * 60 * MINUTE),
      }),
      job({
        key: 'dukon-revalidate',
        lastSuccessAt: new Date(Date.now() - 10 * 24 * 60 * MINUTE),
      }),
      job({
        key: 'dukon-process',
        lastSuccessAt: new Date(Date.now() - 3 * 60 * MINUTE),
      }),
    ]).getHealth();
    expect(health.jobs.map((j) => j.health)).toEqual(['OK', 'OK', 'STALE']);
  });

  it('does not mark an unscheduled manual revalidation stale but retains its errors', async () => {
    const health = await serviceWith([
      job({ key: 'th-tools-revalidate', lastSuccessAt: null }),
      job({
        key: 'th-tools-revalidate',
        lastSuccessAt: null,
        lastError: 'failed',
      }),
    ]).getHealth();
    expect(health.jobs.map((j) => j.health)).toEqual(['OK', 'ERROR']);
    expect(health.jobs[0].maxAgeHours).toBeNull();
  });
});
