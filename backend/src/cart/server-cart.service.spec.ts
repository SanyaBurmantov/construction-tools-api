import { ServerCartService } from './server-cart.service';
import { PrismaService } from '../prisma/prisma.service';

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  sku: string | null;
  status: string;
  priceValue: number | null;
  priceCurrency: string | null;
  oldPrice: number | null;
  stockStatus: string | null;
  images: Array<{ url: string; order: number }>;
};

function product(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'p1',
    slug: 'drel',
    name: 'Дрель',
    sku: 'D-1',
    status: 'PUBLISHED',
    priceValue: 100,
    priceCurrency: 'BYN',
    oldPrice: null,
    stockStatus: 'in_stock',
    images: [],
    ...overrides,
  };
}

function buildService(
  options: {
    /** Rows already stored for the account. */
    stored?: Array<{
      productId: string;
      quantity: number;
      product: ProductRow;
    }>;
    /** Products that exist and are PUBLISHED. */
    catalogue?: ProductRow[];
  } = {},
) {
  const { stored = [], catalogue = [] } = options;

  const rows = stored.map((row, index) => ({
    id: `c${index}`,
    userId: 'u1',
    productId: row.productId,
    quantity: row.quantity,
    createdAt: new Date(2026, 0, index + 1),
    updatedAt: new Date(2026, 0, index + 1),
    product: row.product,
  }));

  const deleteMany = jest.fn((args: { where: Record<string, unknown> }) => {
    deleteManyCalls.push(args.where);
    return Promise.resolve({ count: 0 });
  });
  const deleteManyCalls: Array<Record<string, unknown>> = [];
  const createMany = jest.fn(
    (args: { data: Array<{ productId: string; quantity: number }> }) => {
      createManyCalls.push(args.data);
      return Promise.resolve({ count: args.data.length });
    },
  );
  const createManyCalls: Array<Array<{ productId: string; quantity: number }>> =
    [];
  const create = jest.fn(
    (args: { data: { productId: string; quantity: number } }) => {
      createCalls.push(args.data);
      return Promise.resolve(args.data);
    },
  );
  const createCalls: Array<{ productId: string; quantity: number }> = [];
  const update = jest.fn(
    (args: {
      where: { userId_productId: { productId: string } };
      data: { quantity: number };
    }) => {
      updateCalls.push({
        productId: args.where.userId_productId.productId,
        quantity: args.data.quantity,
      });
      return Promise.resolve(args.data);
    },
  );
  const updateCalls: Array<{ productId: string; quantity: number }> = [];

  const prisma = {
    cartItem: {
      findMany: jest.fn((args: { select?: unknown }) =>
        Promise.resolve(
          args.select
            ? stored.map((row) => ({
                productId: row.productId,
                quantity: row.quantity,
              }))
            : rows,
        ),
      ),
      deleteMany,
      createMany,
      create,
      update,
    },
    product: {
      findMany: jest.fn(() =>
        Promise.resolve(catalogue.filter((p) => p.status === 'PUBLISHED')),
      ),
    },
    // The transaction helper just resolves the promises it is handed.
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : Promise.resolve(arg),
    ),
  } as unknown as PrismaService;

  return {
    service: new ServerCartService(prisma),
    deleteManyCalls,
    createManyCalls,
    createCalls,
    updateCalls,
  };
}

describe('ServerCartService.getCart', () => {
  it('serves the live price, not a stored one', async () => {
    const { service } = buildService({
      stored: [
        {
          productId: 'p1',
          quantity: 2,
          product: product({ priceValue: 149.9, oldPrice: 199 }),
        },
      ],
    });

    const cart = await service.getCart('u1');
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].price).toBe(149.9);
    expect(cart.items[0].oldPrice).toBe(199);
    expect(cart.items[0].quantity).toBe(2);
  });

  it('ignores an oldPrice that is not actually higher', async () => {
    const { service } = buildService({
      stored: [
        {
          productId: 'p1',
          quantity: 1,
          product: product({ priceValue: 100, oldPrice: 90 }),
        },
      ],
    });
    const cart = await service.getCart('u1');
    expect(cart.items[0].oldPrice).toBeNull();
  });

  it('drops a line whose product is no longer published, and deletes the row', async () => {
    const { service, deleteManyCalls } = buildService({
      stored: [
        {
          productId: 'p1',
          quantity: 1,
          product: product({ status: 'HIDDEN' }),
        },
        { productId: 'p2', quantity: 1, product: product({ id: 'p2' }) },
      ],
    });

    const cart = await service.getCart('u1');
    expect(cart.items.map((item) => item.productId)).toEqual(['p2']);
    expect(cart.dropped).toEqual([
      { productId: 'p1', name: 'Дрель', reason: 'unavailable' },
    ]);
    expect(deleteManyCalls).toEqual([
      { userId: 'u1', productId: { in: ['p1'] } },
    ]);
  });

  it('skips supplier placeholder photos when picking the line image', async () => {
    const { service } = buildService({
      stored: [
        {
          productId: 'p1',
          quantity: 1,
          product: product({
            images: [
              {
                url: 'https://th-tool.by/themes/shop/img/default.png',
                order: 0,
              },
              { url: 'https://th-tool.by/real.jpg', order: 1 },
            ],
          }),
        },
      ],
    });
    const cart = await service.getCart('u1');
    expect(cart.items[0].image).toBe('https://th-tool.by/real.jpg');
  });
});

describe('ServerCartService.replace', () => {
  it('stores exactly what the client sent', async () => {
    const { service, createManyCalls, deleteManyCalls } = buildService({
      catalogue: [product(), product({ id: 'p2' })],
    });

    await service.replace('u1', {
      items: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 1 },
      ],
    });

    expect(deleteManyCalls[0]).toEqual({ userId: 'u1' });
    expect(createManyCalls[0]).toEqual([
      { userId: 'u1', productId: 'p1', quantity: 2 },
      { userId: 'u1', productId: 'p2', quantity: 1 },
    ]);
  });

  it('collapses a duplicate id into one summed line', async () => {
    const { service, createManyCalls } = buildService({
      catalogue: [product()],
    });

    await service.replace('u1', {
      items: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p1', quantity: 3 },
      ],
    });

    expect(createManyCalls[0]).toEqual([
      { userId: 'u1', productId: 'p1', quantity: 5 },
    ]);
  });

  it('refuses to store a product that is not orderable', async () => {
    const { service, createManyCalls } = buildService({ catalogue: [] });

    await service.replace('u1', {
      items: [{ productId: 'ghost', quantity: 1 }],
    });

    // Nothing to create — and the old cart was still cleared.
    expect(createManyCalls).toEqual([]);
  });

  it('clears the cart when the client sends an empty list', async () => {
    const { service, deleteManyCalls, createManyCalls } = buildService();
    await service.replace('u1', { items: [] });
    expect(deleteManyCalls[0]).toEqual({ userId: 'u1' });
    expect(createManyCalls).toEqual([]);
  });
});

describe('ServerCartService.merge', () => {
  it('adds a line the account did not have', async () => {
    const { service, createCalls } = buildService({
      stored: [{ productId: 'p1', quantity: 1, product: product() }],
      catalogue: [product({ id: 'p2' })],
    });

    await service.merge('u1', { items: [{ productId: 'p2', quantity: 3 }] });

    expect(createCalls).toEqual([
      { userId: 'u1', productId: 'p2', quantity: 3 },
    ]);
  });

  /**
   * The rule that matters: syncing the same cart twice must not double it.
   */
  it('keeps the larger quantity instead of summing', async () => {
    const { service, updateCalls } = buildService({
      stored: [{ productId: 'p1', quantity: 2, product: product() }],
      catalogue: [product()],
    });

    await service.merge('u1', { items: [{ productId: 'p1', quantity: 5 }] });
    expect(updateCalls).toEqual([{ productId: 'p1', quantity: 5 }]);
  });

  it('leaves the stored quantity alone when the browser has fewer', async () => {
    const { service, updateCalls, createCalls } = buildService({
      stored: [{ productId: 'p1', quantity: 5, product: product() }],
      catalogue: [product()],
    });

    await service.merge('u1', { items: [{ productId: 'p1', quantity: 2 }] });
    expect(updateCalls).toEqual([]);
    expect(createCalls).toEqual([]);
  });

  it('is a plain read when the browser cart is empty', async () => {
    const { service, createCalls, updateCalls, deleteManyCalls } = buildService(
      {
        stored: [{ productId: 'p1', quantity: 1, product: product() }],
      },
    );

    const cart = await service.merge('u1', { items: [] });
    expect(cart.items).toHaveLength(1);
    expect(createCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
    expect(deleteManyCalls).toEqual([]);
  });
});

describe('ServerCartService.purgeStale', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('deletes by a cutoff derived from CART_TTL_DAYS', async () => {
    process.env.CART_TTL_DAYS = '10';
    const { service, deleteManyCalls } = buildService();

    await service.purgeStale();

    const where = deleteManyCalls[0] as { updatedAt: { lte: Date } };
    const days = (Date.now() - where.updatedAt.lte.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(10);
  });

  it('falls back to 90 days for a nonsense value', async () => {
    process.env.CART_TTL_DAYS = 'not-a-number';
    const { service, deleteManyCalls } = buildService();

    await service.purgeStale();

    const where = deleteManyCalls[0] as { updatedAt: { lte: Date } };
    const days = (Date.now() - where.updatedAt.lte.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(90);
  });
});
