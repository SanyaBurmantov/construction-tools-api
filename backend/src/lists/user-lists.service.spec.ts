import { UserListKind } from '@prisma/client';
import { UserListsService } from './user-lists.service';
import { PrismaService } from '../prisma/prisma.service';

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  priceValue: number | null;
  oldPrice: number | null;
  priceCurrency: string | null;
  stockStatus: string | null;
  images: Array<{ url: string; order: number }>;
  category: { slug: string; name: string } | null;
};

function product(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'p1',
    slug: 'drel',
    name: 'Дрель',
    status: 'PUBLISHED',
    priceValue: 100,
    oldPrice: null,
    priceCurrency: 'BYN',
    stockStatus: 'in_stock',
    images: [],
    category: { slug: 'instrument', name: 'Инструмент' },
    ...overrides,
  };
}

function buildService(
  options: {
    stored?: Array<{
      productId: string;
      kind: UserListKind;
      product: ProductRow;
    }>;
    catalogue?: ProductRow[];
  } = {},
) {
  const { stored = [], catalogue = [] } = options;

  const rows = stored.map((row, index) => ({
    id: `l${index}`,
    userId: 'u1',
    productId: row.productId,
    kind: row.kind,
    createdAt: new Date(2026, 0, index + 1),
    product: row.product,
  }));

  const deleteManyCalls: Array<Record<string, unknown>> = [];
  const createManyCalls: Array<
    Array<{ productId: string; kind: UserListKind }>
  > = [];

  const prisma = {
    userListItem: {
      findMany: jest.fn(
        (args: { select?: unknown; where?: { kind?: UserListKind } }) =>
          Promise.resolve(
            args.select
              ? rows
                  .filter(
                    (row) => !args.where?.kind || row.kind === args.where.kind,
                  )
                  .map((row) => ({ productId: row.productId }))
              : rows,
          ),
      ),
      deleteMany: jest.fn((args: { where: Record<string, unknown> }) => {
        deleteManyCalls.push(args.where);
        return Promise.resolve({ count: 0 });
      }),
      createMany: jest.fn(
        (args: { data: Array<{ productId: string; kind: UserListKind }> }) => {
          createManyCalls.push(args.data);
          return Promise.resolve({ count: args.data.length });
        },
      ),
    },
    product: {
      findMany: jest.fn(() =>
        Promise.resolve(
          catalogue.filter((item) => item.status === 'PUBLISHED'),
        ),
      ),
    },
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : Promise.resolve(arg),
    ),
  } as unknown as PrismaService;

  return {
    service: new UserListsService(prisma),
    deleteManyCalls,
    createManyCalls,
  };
}

describe('UserListsService.getLists', () => {
  it('splits the two lists and prices them live', async () => {
    const { service } = buildService({
      stored: [
        {
          productId: 'p1',
          kind: UserListKind.WISHLIST,
          product: product({ priceValue: 149.9, oldPrice: 199 }),
        },
        {
          productId: 'p2',
          kind: UserListKind.COMPARE,
          product: product({ id: 'p2', slug: 'bur', name: 'Бур' }),
        },
      ],
    });

    const lists = await service.getLists('u1');
    expect(lists.wishlist).toHaveLength(1);
    expect(lists.wishlist[0].price).toBe(149.9);
    expect(lists.wishlist[0].oldPrice).toBe(199);
    expect(lists.wishlist[0].categoryName).toBe('Инструмент');
    expect(lists.compare.map((line) => line.productId)).toEqual(['p2']);
  });

  it('drops a product that is no longer published and deletes the row', async () => {
    const { service, deleteManyCalls } = buildService({
      stored: [
        {
          productId: 'p1',
          kind: UserListKind.WISHLIST,
          product: product({ status: 'ARCHIVED' }),
        },
      ],
    });

    const lists = await service.getLists('u1');
    expect(lists.wishlist).toEqual([]);
    expect(deleteManyCalls[0]).toEqual({ id: { in: ['l0'] } });
  });
});

describe('UserListsService.replace', () => {
  it('stores exactly the ids sent, per list', async () => {
    const { service, createManyCalls, deleteManyCalls } = buildService({
      catalogue: [product(), product({ id: 'p2' })],
    });

    await service.replace('u1', { wishlist: ['p1', 'p2'], compare: ['p1'] });

    expect(deleteManyCalls[0]).toEqual({
      userId: 'u1',
      kind: UserListKind.WISHLIST,
    });
    expect(createManyCalls[0].map((row) => row.productId)).toEqual([
      'p1',
      'p2',
    ]);
    expect(createManyCalls[1].map((row) => row.productId)).toEqual(['p1']);
  });

  it('leaves a list alone when it was not sent', async () => {
    const { service, deleteManyCalls } = buildService({
      catalogue: [product()],
    });

    await service.replace('u1', { wishlist: ['p1'] });

    expect(deleteManyCalls).toEqual([
      { userId: 'u1', kind: UserListKind.WISHLIST },
    ]);
  });

  it('refuses ids that are not orderable', async () => {
    const { service, createManyCalls } = buildService({ catalogue: [] });
    await service.replace('u1', { wishlist: ['ghost'] });
    expect(createManyCalls).toEqual([]);
  });

  it('caps the comparison at four', async () => {
    const catalogue = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) =>
      product({ id }),
    );
    const { service, createManyCalls } = buildService({ catalogue });

    await service.replace('u1', { compare: ['p1', 'p2', 'p3', 'p4', 'p5'] });

    expect(createManyCalls[0]).toHaveLength(4);
  });
});

describe('UserListsService.merge', () => {
  it('adds what the browser had and keeps what was stored', async () => {
    const { service, createManyCalls } = buildService({
      stored: [
        { productId: 'p1', kind: UserListKind.WISHLIST, product: product() },
      ],
      catalogue: [product(), product({ id: 'p2' })],
    });

    await service.merge('u1', { wishlist: ['p1', 'p2'] });

    // p1 was already there; only p2 is written, and nothing is deleted.
    expect(createManyCalls[0].map((row) => row.productId)).toEqual(['p2']);
  });

  /**
   * The comparison table someone is already looking at must not reshuffle
   * because they happened to sign in.
   */
  it('keeps the already-stored four when merging into a full comparison', async () => {
    const stored = ['p1', 'p2', 'p3', 'p4'].map((id) => ({
      productId: id,
      kind: UserListKind.COMPARE,
      product: product({ id }),
    }));
    const catalogue = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) =>
      product({ id }),
    );
    const { service, createManyCalls } = buildService({ stored, catalogue });

    await service.merge('u1', { compare: ['p5'] });

    expect(createManyCalls).toEqual([]);
  });

  it('does not touch anything when the browser lists are empty', async () => {
    const { service, createManyCalls, deleteManyCalls } = buildService({
      stored: [
        { productId: 'p1', kind: UserListKind.WISHLIST, product: product() },
      ],
    });

    const lists = await service.merge('u1', {});
    expect(lists.wishlist).toHaveLength(1);
    expect(createManyCalls).toEqual([]);
    expect(deleteManyCalls).toEqual([]);
  });
});

describe('UserListsService.purgeStale', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses LIST_TTL_DAYS, falling back to a year', async () => {
    const { service, deleteManyCalls } = buildService();
    await service.purgeStale();

    const where = deleteManyCalls[0] as { createdAt: { lte: Date } };
    const days = (Date.now() - where.createdAt.lte.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(365);
  });
});
