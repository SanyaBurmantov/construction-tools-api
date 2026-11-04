import {
  FacetsWarmupService,
  MAX_WARMUP_CATEGORIES,
  warmupTargets,
} from './facets-warmup.service';
import { ProductService } from './products.service';

describe('warmupTargets', () => {
  it('takes the header strip, then featured, then roots, without repeats', () => {
    const slugs = warmupTargets({
      headerCategoryIds: ['h1', 'missing'],
      featured: [
        { id: 'f1', slug: 'krepezh' },
        { id: 'h1', slug: 'drel' },
      ],
      roots: [
        { id: 'r1', slug: 'elektroinstrument' },
        { id: 'f1', slug: 'krepezh' },
      ],
      slugById: new Map([['h1', 'drel']]),
    });
    expect(slugs).toEqual(['drel', 'krepezh', 'elektroinstrument']);
  });

  it('is bounded', () => {
    const roots = Array.from({ length: 100 }, (_, i) => ({
      id: `${i}`,
      slug: `c${i}`,
    }));
    expect(
      warmupTargets({
        headerCategoryIds: [],
        featured: [],
        roots,
        slugById: new Map(),
      }),
    ).toHaveLength(MAX_WARMUP_CATEGORIES);
  });
});

describe('FacetsWarmupService.warm', () => {
  it('refreshes the catalogue and each target one at a time; a failure does not stop it', async () => {
    const prisma = {
      siteSetting: { findUnique: jest.fn(() => Promise.resolve(null)) },
      category: {
        findMany: jest.fn((args: { where: { parentId?: null } }) =>
          Promise.resolve(
            'parentId' in args.where
              ? [
                  { id: 'r1', slug: 'a' },
                  { id: 'r2', slug: 'b' },
                ]
              : [],
          ),
        ),
      },
    };
    let inFlight = 0;
    let maxInFlight = 0;
    const findAllFiltered = jest.fn(
      async (filter: { categorySlug?: string }, _options?: unknown) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
        if (filter.categorySlug === 'a') throw new Error('gone');
        return {};
      },
    );
    const service = new FacetsWarmupService(
      prisma as never,
      {
        findAllFiltered,
      } as unknown as ProductService,
    );

    expect(await service.warm()).toBe(2);
    expect(findAllFiltered.mock.calls.map(([f]) => f.categorySlug)).toEqual([
      undefined,
      'a',
      'b',
    ]);
    expect(findAllFiltered.mock.calls[0][1]).toEqual({
      refreshSummaryOlderThanMs: expect.any(Number),
    });
    expect(maxInFlight).toBe(1);
  });
});
