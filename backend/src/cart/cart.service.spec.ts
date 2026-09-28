import { CartService } from './cart.service';
import { PrismaService } from '../prisma/prisma.service';

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  priceValue: number | null;
  priceCurrency: string | null;
  oldPrice?: number | null;
  stockStatus?: string | null;
  images: { url: string }[];
};

function buildService(products: ProductRow[]) {
  const prisma = {
    product: {
      findMany: jest.fn(() => Promise.resolve(products)),
    },
  } as unknown as PrismaService;
  return new CartService(prisma);
}

const drill: ProductRow = {
  id: 'p1',
  name: 'Дрель',
  slug: 'drel',
  status: 'PUBLISHED',
  priceValue: 100,
  priceCurrency: 'BYN',
  stockStatus: 'in_stock',
  images: [{ url: 'http://img/1.jpg' }],
};

describe('CartService.validate', () => {
  it('reports no issues when the client price still matches', async () => {
    const service = buildService([drill]);

    const result = await service.validate({
      items: [{ productId: 'p1', quantity: 2, price: 100 }],
    });

    expect(result.ok).toBe(true);
    expect(result.hasPriceChanges).toBe(false);
    expect(result.itemsTotal).toBe(200);
    expect(result.items[0].issue).toBeNull();
  });

  it('flags a price change and returns both the old and the current price', async () => {
    const service = buildService([drill]);

    const result = await service.validate({
      items: [{ productId: 'p1', quantity: 1, price: 89.9 }],
    });

    expect(result.hasPriceChanges).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.items[0].issue).toBe('price_changed');
    expect(result.items[0].clientPrice).toBe(89.9);
    expect(result.items[0].price).toBe(100);
    // Totals always follow the database, never the client.
    expect(result.itemsTotal).toBe(100);
  });

  it('ignores sub-cent differences instead of reporting a phantom change', async () => {
    const service = buildService([drill]);

    const result = await service.validate({
      items: [{ productId: 'p1', quantity: 1, price: 100.001 }],
    });

    expect(result.items[0].issue).toBeNull();
  });

  it('marks a product that no longer exists as unavailable', async () => {
    const service = buildService([]);

    const result = await service.validate({
      items: [{ productId: 'ghost', quantity: 1, price: 10 }],
    });

    expect(result.items[0].issue).toBe('unavailable');
    expect(result.hasBlocking).toBe(true);
    expect(result.itemsTotal).toBe(0);
  });

  it('marks an unpublished product as unavailable', async () => {
    const service = buildService([{ ...drill, status: 'HIDDEN' }]);

    const result = await service.validate({
      items: [{ productId: 'p1', quantity: 1, price: 100 }],
    });

    expect(result.items[0].issue).toBe('unavailable');
    expect(result.hasBlocking).toBe(true);
  });

  it('blocks a product that lost its price', async () => {
    const service = buildService([{ ...drill, priceValue: null }]);

    const result = await service.validate({
      items: [{ productId: 'p1', quantity: 1, price: 100 }],
    });

    expect(result.items[0].issue).toBe('price_missing');
    expect(result.hasBlocking).toBe(true);
  });

  it('flags backorder stock without blocking the order', async () => {
    const service = buildService([{ ...drill, stockStatus: 'out_of_stock' }]);

    const result = await service.validate({
      items: [{ productId: 'p1', quantity: 1, price: 100 }],
    });

    expect(result.items[0].issue).toBe('out_of_stock');
    expect(result.hasBlocking).toBe(false);
  });

  it('collapses duplicate lines the same way an order would', async () => {
    const service = buildService([drill]);

    const result = await service.validate({
      items: [
        { productId: 'p1', quantity: 2, price: 100 },
        { productId: 'p1', quantity: 3, price: 100 },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(5);
    expect(result.itemsTotal).toBe(500);
  });

  it('works without client prices, reporting only availability', async () => {
    const service = buildService([drill]);

    const result = await service.validate({
      items: [{ productId: 'p1', quantity: 1 }],
    });

    expect(result.items[0].issue).toBeNull();
    expect(result.items[0].clientPrice).toBeNull();
    expect(result.itemsTotal).toBe(100);
  });
});
