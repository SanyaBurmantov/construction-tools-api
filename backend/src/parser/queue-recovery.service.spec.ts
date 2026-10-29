import { QueueRecoveryService } from './queue-recovery.service';

describe('Supplier snapshots refresh', () => {
  it('requeues stale DONE snapshots, recoverable failures and week-old skips', async () => {
    const update = jest.fn(() => Promise.resolve({ count: 2 }));
    const prisma = {
      parserCategoryQueue: { updateMany: update },
      sitemapsThTools: { updateMany: update },
      sitemapsToolsBy: { updateMany: update },
      sitemapsDukon: { updateMany: update },
    };
    const result = await new QueueRecoveryService(
      prisma as never,
    ).requeueRecoverable();
    expect(result.refreshed['tools-by']).toBe(2);
    const calls = update.mock.calls as unknown as Array<
      [{ where: { status: string }; data: Record<string, unknown> }]
    >;
    // SKIPPED rows come back on a slow cycle, keeping their place in line.
    const recheck = calls.find(([arg]) => arg.where.status === 'SKIPPED')![0];
    expect(recheck.where).toMatchObject({
      visitedAt: { lt: expect.any(Date) as Date },
    });
    expect(recheck.data).not.toHaveProperty('visitedAt');
    expect(result.rechecked.dukon).toBe(2);
    // A PENDING row that used up its attempts is parked, not retried forever.
    const parked = calls.find(
      ([arg]) => arg.where.status === 'PENDING' && arg.data.status === 'FAILED',
    )![0];
    expect(parked.where).toMatchObject({ attempts: { gte: 3 } });
    // An outage burns every URL's attempts; they get a fresh budget after a
    // few days — except a URL that crashed the process.
    const revive = calls.find(
      ([arg]) =>
        arg.where.status === 'FAILED' &&
        (arg.where as { attempts?: { gte?: number } }).attempts?.gte === 3,
    )![0];
    expect(revive.where).toMatchObject({
      lastTriedAt: { lt: expect.any(Date) as Date },
      OR: [
        { lastError: null },
        {
          lastError: {
            not: expect.stringContaining('ни разу не завершился') as string,
          },
        },
      ],
    });
    expect(revive.data).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(result.revived['th-tools']).toBe(2);
    const refresh = calls.find(([arg]) => arg.where.status === 'DONE')![0];
    expect(refresh.where).toMatchObject({
      visitedAt: { lt: expect.any(Date) as Date },
    });
    expect(refresh.data).toMatchObject({
      status: 'PENDING',
      isVisited: false,
      attempts: 0,
    });
    expect(refresh.data).not.toHaveProperty('visitedAt');
  });

  it('brings failed categories back instead of leaving them dead', async () => {
    const productUpdate = jest.fn(() => Promise.resolve({ count: 0 }));
    const categoryUpdate = jest.fn(() => Promise.resolve({ count: 716 }));
    const prisma = {
      parserCategoryQueue: { updateMany: categoryUpdate },
      sitemapsThTools: { updateMany: productUpdate },
      sitemapsToolsBy: { updateMany: productUpdate },
      sitemapsDukon: { updateMany: productUpdate },
    };
    const result = await new QueueRecoveryService(
      prisma as never,
    ).requeueRecoverable();

    const calls = categoryUpdate.mock.calls as unknown as Array<
      [{ where: Record<string, unknown>; data: Record<string, unknown> }]
    >;
    const failed = calls.filter(([arg]) => arg.where.status === 'FAILED');
    // A recent failure is retried within its attempt budget…
    expect(failed[0][0].where).toMatchObject({
      sourceCode: 'th-tools',
      isEnabled: true,
      attempts: { lt: 3 },
      lastTriedAt: { lt: expect.any(Date) as Date },
    });
    expect(failed[0][0].data).toEqual({ status: 'PENDING' });
    // …and an exhausted one gets a fresh budget after a few days (an outage).
    expect(failed[1][0].where).toMatchObject({ attempts: { gte: 3 } });
    expect(failed[1][0].data).toEqual({ status: 'PENDING', attempts: 0 });
    expect(result.categoriesRetried).toBe(716);
    expect(result.categoriesRevived).toBe(716);
  });
});
