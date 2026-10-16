import { mapWithConcurrency, runWithConcurrency } from './run-with-concurrency';

describe('runWithConcurrency', () => {
  it('processes falsy items too', async () => {
    const seen: unknown[] = [];
    await runWithConcurrency([0, '', 1], 2, (item) => {
      seen.push(item);
      return Promise.resolve();
    });
    expect(seen.sort()).toEqual(['', 0, 1].sort());
  });

  // The caller releases its job lock when this settles; a sibling still
  // running at that point overlapped the next run.
  it('settles only after every worker stopped, then rethrows', async () => {
    const finished: number[] = [];
    await expect(
      runWithConcurrency([1, 2, 3, 4], 2, async (item) => {
        if (item === 1) throw new Error('boom');
        await new Promise((resolve) => setTimeout(resolve, 5));
        finished.push(item);
      }),
    ).rejects.toThrow('boom');
    expect(finished.sort()).toEqual([2, 3, 4]);
  });

  it('keeps results in input order', async () => {
    await expect(
      mapWithConcurrency([3, 1, 2], 3, async (n) => {
        await new Promise((resolve) => setTimeout(resolve, n));
        return n * 10;
      }),
    ).resolves.toEqual([30, 10, 20]);
  });
});
