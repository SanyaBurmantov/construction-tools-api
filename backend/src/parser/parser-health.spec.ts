import { ParserRuntimeStatusService } from './parser-runtime-status.service';
import { PrismaService } from '../prisma/prisma.service';

const MINUTE = 60_000;

function serviceWith(rows: unknown[]) {
  const prisma = {
    parserRuntimeStatus: { findMany: jest.fn(() => Promise.resolve(rows)) },
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
});
