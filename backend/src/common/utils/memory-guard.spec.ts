import * as v8 from 'node:v8';
import { shouldRestart, startMemoryGuard } from './memory-guard';

jest.mock('node:v8', () => ({ getHeapStatistics: jest.fn() }));

const heap = (used: number, limit = 1000) =>
  (v8.getHeapStatistics as jest.Mock).mockReturnValue({
    used_heap_size: used,
    heap_size_limit: limit,
  });

describe('memory guard', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('restarts at or above the ratio only', () => {
    expect(shouldRestart(0.84, 0.85)).toBe(false);
    expect(shouldRestart(0.85, 0.85)).toBe(true);
  });

  const start = (close: () => Promise<unknown>, exit: jest.Mock) =>
    startMemoryGuard({
      maxHeapRatio: 0.85,
      checkEveryMs: 1000,
      reportEveryMs: 0,
      close,
      closeTimeoutMs: 5000,
      exit,
    });

  it('stays quiet below the threshold', async () => {
    heap(500);
    const close = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    const timer = start(close, exit);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(close).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it('closes the app and exits non-zero once over the threshold', async () => {
    heap(900);
    const close = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    start(close, exit);
    await jest.advanceTimersByTimeAsync(1000);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('exits even when the graceful shutdown hangs', async () => {
    heap(900);
    const close = jest.fn(() => new Promise(() => undefined));
    const exit = jest.fn();
    start(close, exit);
    await jest.advanceTimersByTimeAsync(1000);
    expect(exit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5000);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
