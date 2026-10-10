import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { PromoService } from '../promo/promo.service';
import { TelegramService } from '../notifications/telegram.service';
import { ServerCartService } from '../cart/server-cart.service';
import { PromoCode, PromoCodeType } from '@prisma/client';

function buildPromoCode(overrides: Partial<PromoCode> = {}): PromoCode {
  return {
    id: 'promo-1',
    code: 'SALE10',
    description: null,
    type: PromoCodeType.PERCENT,
    value: 10,
    minOrderTotal: null,
    maxUses: null,
    usedCount: 0,
    startsAt: null,
    endsAt: null,
    isActive: true,
    freeDelivery: false,
    isPublic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  priceValue: number | null;
  priceCurrency: string | null;
  oldPrice?: number | null;
  images: { url: string }[];
};

function buildService(products: ProductRow[], promoCode?: PromoCode) {
  const createMock = jest.fn((args: { data: unknown }) => ({
    id: 'order-1',
    number: 1,
    ...(args.data as object),
  }));
  const promoUpdateMock = jest.fn(() => Promise.resolve({}));
  const tx = {
    order: { create: createMock },
    promoCode: { update: promoUpdateMock },
  };
  const prisma = {
    product: {
      findMany: jest.fn(() => Promise.resolve(products)),
    },
    order: {
      create: createMock,
    },
    promoCode: {
      findUnique: jest.fn(() => Promise.resolve(promoCode ?? null)),
    },
    // Run the callback inline against the same mocks — these tests assert on
    // the data passed to order.create, not on transactional semantics.
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const promo = new PromoService(prisma);
  const notifyMock = jest.fn(() => Promise.resolve(true));
  const telegram = {
    enabled: true,
    notifyNewOrder: notifyMock,
  } as unknown as TelegramService;
  const clearCartMock = jest.fn(() =>
    Promise.resolve({ ok: true, removed: 0 }),
  );
  const serverCart = {
    clear: clearCartMock,
  } as unknown as ServerCartService;

  return {
    service: new OrdersService(prisma, promo, telegram, serverCart),
    createMock,
    promoUpdateMock,
    notifyMock,
    clearCartMock,
  };
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

  it('applies a percent promo code and counts the use', async () => {
    const { service, createMock, promoUpdateMock } = buildService(
      [
        {
          id: 'p1',
          name: 'Дрель',
          slug: 'drel',
          status: 'PUBLISHED',
          priceValue: 200,
          priceCurrency: 'BYN',
          images: [],
        },
      ],
      buildPromoCode({ value: 10 }),
    );

    await service.createOrder({
      ...baseCustomer,
      deliveryMethod: 'PICKUP',
      items: [{ productId: 'p1', quantity: 1 }],
      promoCode: 'sale10',
    });

    const data = createMock.mock.calls[0][0].data as {
      itemsTotal: number;
      discountTotal: number;
      total: number;
      promoCodeLabel: string;
    };
    expect(data.itemsTotal).toBe(200);
    expect(data.discountTotal).toBe(20);
    expect(data.total).toBe(180);
    expect(data.promoCodeLabel).toBe('SALE10');
    expect(promoUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('caps a fixed promo code at the cart subtotal', async () => {
    const { service, createMock } = buildService(
      [
        {
          id: 'p1',
          name: 'Бур',
          slug: 'bur',
          status: 'PUBLISHED',
          priceValue: 30,
          priceCurrency: 'BYN',
          images: [],
        },
      ],
      buildPromoCode({ type: PromoCodeType.FIXED, value: 500 }),
    );

    await service.createOrder({
      ...baseCustomer,
      deliveryMethod: 'PICKUP',
      items: [{ productId: 'p1', quantity: 1 }],
      promoCode: 'SALE10',
    });

    const data = createMock.mock.calls[0][0].data as {
      discountTotal: number;
      total: number;
    };
    expect(data.discountTotal).toBe(30);
    expect(data.total).toBe(0);
  });

  it('rejects an expired promo code', async () => {
    const { service } = buildService(
      [
        {
          id: 'p1',
          name: 'Бур',
          slug: 'bur',
          status: 'PUBLISHED',
          priceValue: 30,
          priceCurrency: 'BYN',
          images: [],
        },
      ],
      buildPromoCode({ endsAt: new Date('2020-01-01') }),
    );

    await expect(
      service.createOrder({
        ...baseCustomer,
        deliveryMethod: 'PICKUP',
        items: [{ productId: 'p1', quantity: 1 }],
        promoCode: 'SALE10',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('snapshots oldPrice only when it is above the current price', async () => {
    const { service, createMock } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 80,
        oldPrice: 100,
        priceCurrency: 'BYN',
        images: [],
      },
      {
        id: 'p2',
        name: 'Бур',
        slug: 'bur',
        status: 'PUBLISHED',
        priceValue: 50,
        oldPrice: 40,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);

    await service.createOrder({
      ...baseCustomer,
      deliveryMethod: 'PICKUP',
      items: [
        { productId: 'p1', quantity: 1 },
        { productId: 'p2', quantity: 1 },
      ],
    });

    const data = createMock.mock.calls[0][0].data as {
      items: { create: { unitOldPrice: number | null }[] };
    };
    expect(data.items.create[0].unitOldPrice).toBe(100);
    expect(data.items.create[1].unitOldPrice).toBeNull();
  });

  it('notifies Telegram about the created order', async () => {
    const { service, notifyMock } = buildService([
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
      items: [{ productId: 'p1', quantity: 1 }],
    });

    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  // The order is already committed by the time we notify, so a failing
  // notification must never surface as a failed order.
  it('still returns the order when the Telegram notification fails', async () => {
    const { service, notifyMock } = buildService([
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
    notifyMock.mockRejectedValueOnce(new Error('telegram is down') as never);

    await expect(
      service.createOrder({
        ...baseCustomer,
        deliveryMethod: 'PICKUP',
        items: [{ productId: 'p1', quantity: 1 }],
      }),
    ).resolves.toMatchObject({ id: 'order-1' });
  });

  // Supplier prices drift daily, so an order must never quietly cost more
  // than the cart the customer was looking at.
  it('rejects the order when the total the customer saw no longer matches', async () => {
    const { service, createMock } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 210,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);

    await expect(
      service.createOrder({
        ...baseCustomer,
        deliveryMethod: 'PICKUP',
        items: [{ productId: 'p1', quantity: 1 }],
        expectedItemsTotal: 189.9,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(createMock).not.toHaveBeenCalled();
  });

  it('accepts the order when the expected total still matches', async () => {
    const { service, createMock } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 189.9,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);

    await service.createOrder({
      ...baseCustomer,
      deliveryMethod: 'PICKUP',
      items: [{ productId: 'p1', quantity: 1 }],
      expectedItemsTotal: 189.9,
    });

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('skips the price check when the client sends no expected total', async () => {
    const { service, createMock } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 210,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);

    await service.createOrder({
      ...baseCustomer,
      deliveryMethod: 'PICKUP',
      items: [{ productId: 'p1', quantity: 1 }],
    });

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('stamps the order with the account when one placed it', async () => {
    const { service, createMock } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 100,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);

    await service.createOrder(
      {
        ...baseCustomer,
        deliveryMethod: 'PICKUP',
        items: [{ productId: 'p1', quantity: 1 }],
      },
      'u1',
    );

    const data = createMock.mock.calls[0][0].data as { userId: string | null };
    expect(data.userId).toBe('u1');
  });

  it('empties the stored cart of the account that ordered', async () => {
    const { service, clearCartMock } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 100,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);

    await service.createOrder(
      {
        ...baseCustomer,
        deliveryMethod: 'PICKUP',
        items: [{ productId: 'p1', quantity: 1 }],
      },
      'u1',
    );

    expect(clearCartMock).toHaveBeenCalledWith('u1');
  });

  // The order is already committed when the cart is cleared, so a failure
  // there must not reach the customer.
  it('still returns the order when clearing the stored cart fails', async () => {
    const { service, clearCartMock } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 100,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);
    clearCartMock.mockRejectedValueOnce(new Error('db is down'));

    const order = await service.createOrder(
      {
        ...baseCustomer,
        deliveryMethod: 'PICKUP',
        items: [{ productId: 'p1', quantity: 1 }],
      },
      'u1',
    );

    expect(order.id).toBe('order-1');
  });

  // Guest checkout is still the default path: no account, no link.
  it('leaves userId null for a guest order', async () => {
    const { service, createMock } = buildService([
      {
        id: 'p1',
        name: 'Дрель',
        slug: 'drel',
        status: 'PUBLISHED',
        priceValue: 100,
        priceCurrency: 'BYN',
        images: [],
      },
    ]);

    await service.createOrder({
      ...baseCustomer,
      deliveryMethod: 'PICKUP',
      items: [{ productId: 'p1', quantity: 1 }],
    });

    const data = createMock.mock.calls[0][0].data as { userId: string | null };
    expect(data.userId).toBeNull();
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
