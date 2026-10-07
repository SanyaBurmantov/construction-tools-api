import { OffersService } from './offers.service';

describe('Selected supplier discount', () => {
  it('takes the old price from the cheapest available offer without mixing suppliers', async () => {
    const applyCost = jest.fn(() => Promise.resolve());
    const updateStock = jest.fn(() => Promise.resolve());
    const prisma = {
      product: { update: updateStock },
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
      product: { update: updateStock },
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
