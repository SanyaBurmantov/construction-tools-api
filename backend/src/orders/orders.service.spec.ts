import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  priceValue: number | null;
  priceCurrency: string | null;
  images: { url: string }[];
};

function buildService(products: ProductRow[]) {
  const createMock = jest.fn((args: { data: unknown }) => ({
    id: 'order-1',
    number: 1,
    ...(args.data as object),
  }));
  const prisma = {
    product: {
      findMany: jest.fn(() => Promise.resolve(products)),
    },
    order: {
      create: createMock,
    },
  } as unknown as PrismaService;
  return { service: new OrdersService(prisma), createMock };
}

const baseCustomer = {
  customerName: 'Иван',
  customerPhone: '+375290000000',
  paymentMethod: 'CASH' as const,
};

describe('OrdersService.createOrder', () => {
  it('re-prices items from the DB and sums totals with pickup (no delivery cost)', async () => {
    const { service, createMock } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 100,
        priceCurrency: 'BYN',
        images: [{ url: 'http://img/1.jpg' }],
      },
      {
        id: 'p2',
        name: 'Бур',
        slug: 'bur',
        status: 'PUBLISHED',
        priceValue: 25.5,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);

    const dto: CreateOrderDto = {
      ...baseCustomer,
      deliveryMethod: 'PICKUP',
      items: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 1 },
      ],
    };

    await service.createOrder(dto);

    const data = createMock.mock.calls[0][0].data as {
      itemsTotal: number;
      deliveryCost: number;
      total: number;
      items: { create: { unitPrice: number; lineTotal: number }[] };
    };
    expect(data.itemsTotal).toBe(225.5);
    expect(data.deliveryCost).toBe(0);
    expect(data.total).toBe(225.5);
    expect(data.items.create[0].unitPrice).toBe(100);
    expect(data.items.create[0].lineTotal).toBe(200);
  });

  it('adds courier delivery cost', async () => {
    const { service, createMock } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 50,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);

    await service.createOrder({
      ...baseCustomer,
      deliveryMethod: 'COURIER',
      deliveryAddress: 'ул. Ленина, 1',
      items: [{ productId: 'p1', quantity: 1 }],
    });

    const data = createMock.mock.calls[0][0].data as {
      deliveryCost: number;
      total: number;
    };
    expect(data.deliveryCost).toBe(15);
    expect(data.total).toBe(65);
  });

  it('collapses duplicate productIds into one summed line', async () => {
    const { service, createMock } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 10,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);

    await service.createOrder({
      ...baseCustomer,
      deliveryMethod: 'PICKUP',
      items: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p1', quantity: 3 },
      ],
    });

    const data = createMock.mock.calls[0][0].data as {
      items: { create: { quantity: number; lineTotal: number }[] };
      itemsTotal: number;
    };
    expect(data.items.create).toHaveLength(1);
    expect(data.items.create[0].quantity).toBe(5);
    expect(data.itemsTotal).toBe(50);
  });

  it('rejects unavailable products', async () => {
    const { service } = buildService([]);
    await expect(
      service.createOrder({
        ...baseCustomer,
        deliveryMethod: 'PICKUP',
        items: [{ productId: 'missing', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires delivery address for courier', async () => {
    const { service } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 10,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);
    await expect(
      service.createOrder({
        ...baseCustomer,
        deliveryMethod: 'COURIER',
        items: [{ productId: 'p1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
