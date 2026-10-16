import { QueueRecoveryService } from './queue-recovery.service';

describe('Supplier snapshots refresh', () => {
  it('requeues stale DONE snapshots, recoverable failures and week-old skips', async () => {
    const update = jest.fn(() => Promise.resolve({ count: 2 }));
    const prisma = {
      parserCategoryQueue: { updateMany: update },
      sitemapsThTools: { updateMany: update },
      sitemapsToolsBy: { updateMany: update },
      sitemapsDukon: { updateMany: update },
      sitemaps7745: { updateMany: update },
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
});
