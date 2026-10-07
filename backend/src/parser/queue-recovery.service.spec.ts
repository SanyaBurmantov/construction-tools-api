import { QueueRecoveryService } from './queue-recovery.service';

describe('Supplier snapshots refresh', () => {
  it('requeues stale DONE snapshots and recoverable failures while preserving intentional skips', async () => {
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
    expect(calls.map(([arg]) => arg.where.status)).not.toContain('SKIPPED');
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
