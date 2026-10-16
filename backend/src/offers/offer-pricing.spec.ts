import { OffersService } from './offers.service';

describe('Selected supplier discount', () => {
  it('takes the old price from the cheapest available offer without mixing suppliers', async () => {
    const applyCost = jest.fn(() => Promise.resolve());
    const updateStock = jest.fn(() => Promise.resolve());
    const prisma = {
      product: {
        update: updateStock,
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      sourceProduct: {
        findMany: () =>
          Promise.resolve([
            {
              price: 50,
              stock: false,
              specifications: { source: { oldPrice: 150 } },
            },
            {
              price: 70,
              stock: true,
              specifications: { source: { oldPrice: 100 } },
            },
            {
              price: 80,
              stock: true,
              specifications: { source: { oldPrice: 120 } },
            },
          ]),
      },
    };
    await new OffersService(
      prisma as never,
      { applyCost } as never,
      {} as never,
    ).recomputeFromOffers('product');
    expect(applyCost).toHaveBeenCalledWith('product', 70, { oldCost: 100 });
    expect(updateStock).toHaveBeenCalledWith({
      where: { id: 'product' },
      data: { stockStatus: 'in_stock' },
    });
  });
  it('clears a finished supplier discount', async () => {
    const applyCost = jest.fn(() => Promise.resolve());
    const updateStock = jest.fn(() => Promise.resolve());
    const prisma = {
      product: {
        update: updateStock,
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      sourceProduct: {
        findMany: () =>
          Promise.resolve([{ price: 70, stock: true, specifications: {} }]),
      },
    };
    await new OffersService(
      prisma as never,
      { applyCost } as never,
      {} as never,
    ).recomputeFromOffers('product');
    expect(applyCost).toHaveBeenCalledWith('product', 70, { oldCost: null });
  });
});

describe('Automatic publication', () => {
  function build(updateMany: jest.Mock) {
    const prisma = {
      product: { update: jest.fn(() => Promise.resolve()), updateMany },
      sourceProduct: {
        findMany: () =>
          Promise.resolve([{ price: 70, stock: true, specifications: {} }]),
      },
    };
    return new OffersService(
      prisma as never,
      { applyCost: jest.fn(() => Promise.resolve()) } as never,
      {} as never,
    );
  }

  // A new product is created in DRAFT; a delisted one is HIDDEN by the
  // system. Both come on sale once priced — never an admin's decision.
  it('publishes a system DRAFT or HIDDEN product once it is priced', async () => {
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    await build(updateMany).recomputeFromOffers('p1');
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'p1',
        statusSource: 'SYSTEM',
        status: { in: ['DRAFT', 'HIDDEN'] },
        priceValue: { gt: 0 },
      },
      data: { status: 'PUBLISHED' },
    });
  });
});
