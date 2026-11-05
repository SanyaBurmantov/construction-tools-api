import { IndexNowSeedService } from './indexnow-seed.service';

function setup(productIds: string[], settings: Record<string, string> = {}) {
  const store = new Map(Object.entries(settings));
  const enqueue = jest.fn(() => Promise.resolve());
  const prisma = {
    siteSetting: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(
          store.has(where.key) ? { value: store.get(where.key) } : null,
        ),
      ),
      upsert: jest.fn(
        ({
          where,
          update,
        }: {
          where: { key: string };
          update: { value: string };
        }) => {
          store.set(where.key, update.value);
          return Promise.resolve();
        },
      ),
    },
    $queryRaw: jest.fn((strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join('').includes('"Category"')
          ? [{ slug: 'krepezh' }]
          : [{ slug: 'bull' }],
      ),
    ),
    product: {
      findMany: jest.fn(
        ({ where, take }: { where: { id?: { gt: string } }; take: number }) =>
          Promise.resolve(
            productIds
              .filter((id) => !where.id || id > where.id.gt)
              .slice(0, take)
              .map((id) => ({ id, slug: `p-${id}` })),
          ),
      ),
    },
  };
  const service = new IndexNowSeedService(
    prisma as never,
    { enabled: true, enqueue } as never,
  );
  return { service, enqueue, store };
}

describe('IndexNowSeedService', () => {
  const old = process.env.INDEXNOW_SEED_PER_DAY;
  afterEach(() => {
    process.env.INDEXNOW_SEED_PER_DAY = old;
  });

  it('starts with the shop pages, categories and brands, then products by id', async () => {
    process.env.INDEXNOW_SEED_PER_DAY = '8';
    const { service, enqueue, store } = setup(['a', 'b', 'c', 'd', 'e']);
    await service.seedNext();
    expect(enqueue).toHaveBeenLastCalledWith([
      '/',
      '/catalog',
      '/brand',
      '/sales',
      '/catalog/krepezh',
      '/brand/bull',
      '/product/p-a',
      '/product/p-b',
    ]);
    expect(store.get('indexnow.seed.cursor')).toBe('b');

    await service.seedNext();
    expect(enqueue).toHaveBeenLastCalledWith([
      '/product/p-c',
      '/product/p-d',
      '/product/p-e',
    ]);
    // Fewer than a full night left: the pass is over and stops.
    expect(store.get('indexnow.seed.doneAt')).toBeDefined();
    expect(await service.seedNext()).toBe(0);
  });

  it('is off at INDEXNOW_SEED_PER_DAY=0', async () => {
    process.env.INDEXNOW_SEED_PER_DAY = '0';
    const { service, enqueue } = setup(['a']);
    expect(await service.seedNext()).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
