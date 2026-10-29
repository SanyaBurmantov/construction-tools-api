import { ConflictException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { OrdersService } from './orders.service';

/** One order row whose status another request may have moved meanwhile. */
function build(stored: OrderStatus, movedMeanwhile = false) {
  const order = {
    id: 'o1',
    status: stored,
    promoCodeId: 'promo-1',
    items: [],
    user: null,
  };
  const executeRaw = jest.fn(() => Promise.resolve(1));
  const tx = {
    order: {
      updateMany: jest.fn(({ where }: { where: { status: OrderStatus } }) =>
        Promise.resolve({
          count: !movedMeanwhile && where.status === stored ? 1 : 0,
        }),
      ),
      findUniqueOrThrow: jest.fn(() =>
        Promise.resolve({ ...order, status: OrderStatus.CANCELLED }),
      ),
    },
    $executeRaw: executeRaw,
  };
  const prisma = {
    order: { findUnique: jest.fn(() => Promise.resolve(order)) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const service = new OrdersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, executeRaw };
}

describe('OrdersService.updateStatus', () => {
  it('cancels and gives the promo use back once', async () => {
    const { service, executeRaw } = build(OrderStatus.NEW);
    await service.updateStatus('o1', { status: OrderStatus.CANCELLED });
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('loses a race with a parallel move: 409, and no second promo give-back', async () => {
    const { service, executeRaw } = build(OrderStatus.NEW, true);
    await expect(
      service.updateStatus('o1', { status: OrderStatus.CANCELLED }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
