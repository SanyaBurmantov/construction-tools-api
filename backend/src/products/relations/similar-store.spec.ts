import {
  RecommendationsService,
  SIMILAR_RULE_VERSION,
  SIMILAR_TTL_MS,
} from './recommendations.service';
import { SimilarRefreshService } from './similar-refresh.service';

type Internals = {
  similarEntries: (
    product: unknown,
    familyKey: string | null,
    options?: { fresh?: boolean },
  ) => Promise<Array<{ id: string; tier: number }>>;
  similarCards: (
    product: unknown,
    entries: unknown[],
  ) => Promise<Array<{ id: string }>>;
  computeSimilarEntries: () => Promise<Array<{ id: string; tier: number }>>;
};

const product = { id: 'p', contentUpdatedAt: new Date('2026-11-01T00:00:00Z') };

function build(stored: Record<string, unknown> | null) {
  const upsert = jest.fn(() => Promise.resolve({}));
  const prisma = {
    productSimilar: {
      findUnique: jest.fn(() => Promise.resolve(stored)),
      upsert,
    },
  };
  const service = new RecommendationsService(prisma as never);
  const internals = service as unknown as Internals;
  const compute = jest.fn(() => Promise.resolve([{ id: 'fresh', tier: 0 }]));
  internals.computeSimilarEntries = compute;
  return { internals, compute, upsert };
}

describe('stored «Похожие»', () => {
  const usable = {
    entries: [{ id: 'stored', tier: 0 }],
    ruleVersion: SIMILAR_RULE_VERSION,
    computedAt: new Date(),
  };

  it('reads a usable stored row without ranking anything', async () => {
    const { internals, compute } = build(usable);
    expect(await internals.similarEntries(product, null)).toEqual(
      usable.entries,
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an old rule version',
      { ...usable, ruleVersion: SIMILAR_RULE_VERSION - 1 },
    ],
    [
      'an expired row',
      { ...usable, computedAt: new Date(Date.now() - SIMILAR_TTL_MS - 1) },
    ],
    [
      'a row older than the product text',
      { ...usable, computedAt: new Date('2026-10-31T00:00:00Z') },
    ],
    ['no row', null],
  ])('recomputes and stores on %s', async (_label, stored) => {
    const { internals, compute, upsert } = build(stored);
    expect(await internals.similarEntries(product, null)).toEqual([
      { id: 'fresh', tier: 0 },
    ]);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('shows only what is on sale now, own category before elsewhere, in stock first within a tier', async () => {
    const card = (id: string, stockStatus: string) => ({
      id,
      stockStatus,
      images: [],
    });
    const prisma = {
      product: {
        // «gone» is no longer on sale: the live query does not return it.
        findMany: jest.fn(() =>
          Promise.resolve([
            card('own-out', 'out_of_stock'),
            card('own-in', 'in_stock'),
            card('else-in', 'in_stock'),
          ]),
        ),
      },
      productFitment: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const internals = new RecommendationsService(
      prisma as never,
    ) as unknown as Internals;
    const cards = await internals.similarCards(product, [
      { id: 'own-out', tier: 0 },
      { id: 'gone', tier: 0 },
      { id: 'own-in', tier: 0 },
      { id: 'else-in', tier: 1 },
    ]);
    expect(cards.map((c) => c.id)).toEqual(['own-in', 'own-out', 'else-in']);
  });
});

describe('SimilarRefreshService', () => {
  it('refreshes the stale products one by one and survives a failure', async () => {
    const prisma = {
      $queryRaw: jest.fn(() =>
        Promise.resolve([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
      ),
      $executeRaw: jest.fn(() => Promise.resolve(0)),
    };
    const refreshSimilar = jest.fn((id: string) =>
      id === 'b' ? Promise.reject(new Error('boom')) : Promise.resolve(true),
    );
    const service = new SimilarRefreshService(
      prisma as never,
      {
        refreshSimilar,
      } as unknown as RecommendationsService,
    );
    expect(await service.tick()).toBe(2);
    expect(refreshSimilar.mock.calls.map(([id]) => id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
