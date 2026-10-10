import { NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { AccountService } from './account.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthService, PublicUser } from '../auth/auth.service';
import type { PromoService } from '../promo/promo.service';

const profile = { id: 'u1', login: 'ivanov' } as unknown as PublicUser;

function buildService(
  options: {
    orders?: Array<Record<string, unknown>>;
    order?: Record<string, unknown> | null;
    groups?: Array<{ status: OrderStatus; _count: { _all: number } }>;
    sum?: number | null;
    promoCodes?: Array<{ code: string }>;
  } = {},
) {
  const {
    orders = [],
    order = null,
    groups = [],
    sum = null,
    promoCodes = [],
  } = options;

  // Queries are recorded rather than typed onto an unused callback parameter,
  // so the assertions below read them without a cast.
  type OrderQuery = { where?: Record<string, unknown>; take?: number };
  const listQueries: OrderQuery[] = [];
  const oneQueries: OrderQuery[] = [];
  const findMany = jest.fn((args: OrderQuery) => {
    listQueries.push(args);
    return Promise.resolve(orders);
  });
  const findFirst = jest.fn((args: OrderQuery) => {
    oneQueries.push(args);
    return Promise.resolve(order);
  });

  const prisma = {
    order: {
      findMany,
      findFirst,
      count: jest.fn(() => Promise.resolve(orders.length)),
      groupBy: jest.fn(() => Promise.resolve(groups)),
      aggregate: jest.fn(() => Promise.resolve({ _sum: { total: sum } })),
    },
  } as unknown as PrismaService;

  const promo = {
    listAvailable: jest.fn(() => Promise.resolve({ data: promoCodes })),
  } as unknown as PromoService;

  const auth = {
    getProfile: jest.fn(() => Promise.resolve(profile)),
  } as unknown as AuthService;

  return {
    service: new AccountService(prisma, promo, auth),
    listQueries,
    oneQueries,
  };
}

describe('AccountService.getSummary', () => {
  it('counts orders by status, sums what was spent and the promo codes', async () => {
    const { service } = buildService({
      groups: [
        { status: OrderStatus.NEW, _count: { _all: 2 } },
        { status: OrderStatus.DELIVERED, _count: { _all: 3 } },
        { status: OrderStatus.CANCELLED, _count: { _all: 1 } },
      ],
      sum: 1234.567,
      promoCodes: [{ code: 'SALE10' }, { code: 'FREESHIP' }],
    });

    const summary = await service.getSummary('u1');

    expect(summary.user).toBe(profile);
    expect(summary.orders.total).toBe(6);
    expect(summary.orders.byStatus).toEqual({
      NEW: 2,
      DELIVERED: 3,
      CANCELLED: 1,
    });
    // Rounded to money, not left as a floating-point sum.
    expect(summary.orders.totalSpent).toBe(1234.57);
    expect(summary.promoCodes.available).toBe(2);
  });

  it('reports zeros for an account that never ordered', async () => {
    const { service } = buildService();
    const summary = await service.getSummary('u1');
    expect(summary.orders.total).toBe(0);
    expect(summary.orders.totalSpent).toBe(0);
    expect(summary.orders.last).toBeNull();
  });
});

describe('AccountService.listOrders', () => {
  it('scopes the query to the session account', async () => {
    const { service, listQueries } = buildService({ orders: [{ id: 'o1' }] });
    await service.listOrders('u1', {});
    expect(listQueries[0].where).toEqual({ userId: 'u1' });
  });

  it('adds a status filter when asked', async () => {
    const { service, listQueries } = buildService();
    await service.listOrders('u1', { status: OrderStatus.DELIVERED });
    expect(listQueries[0].where).toEqual({
      userId: 'u1',
      status: OrderStatus.DELIVERED,
    });
  });

  it('caps the page size however large a limit is asked for', async () => {
    const { service, listQueries } = buildService();
    await service.listOrders('u1', { limit: 5000 });
    expect(listQueries[0].take).toBe(50);
  });

  it('always reports at least one page, so the pager has something to render', async () => {
    const { service } = buildService();
    const result = await service.listOrders('u1', {});
    expect(result.pagination.pages).toBe(1);
  });
});

describe('AccountService.getOrder', () => {
  it('looks the order up by id AND owner', async () => {
    const { service, oneQueries } = buildService({ order: { id: 'o1' } });
    await service.getOrder('u1', 'o1');
    expect(oneQueries[0].where).toEqual({
      id: 'o1',
      userId: 'u1',
    });
  });

  // Someone else's order id must not be distinguishable from a wrong one.
  it('answers 404 for an order that is not theirs', async () => {
    const { service } = buildService({ order: null });
    await expect(service.getOrder('u1', 'o2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
