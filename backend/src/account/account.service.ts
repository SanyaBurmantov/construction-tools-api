import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PromoService } from '../promo/promo.service';
import { AuthService } from '../auth/auth.service';
import { AccountOrderQueryDto } from './dto/account-order-query.dto';

/**
 * What a customer may see about their own order. Deliberately narrower than
 * the admin projection: no internal ids beyond the order's own, no promo code
 * id, and nothing about the supplier behind a line.
 */
const ORDER_SELECT = {
  id: true,
  number: true,
  status: true,
  currency: true,
  itemsTotal: true,
  deliveryCost: true,
  discountTotal: true,
  total: true,
  promoCodeLabel: true,
  deliveryMethod: true,
  deliveryAddress: true,
  paymentMethod: true,
  comment: true,
  customerName: true,
  customerPhone: true,
  customerEmail: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      // Needed by "повторить заказ": the storefront puts these back into the
      // cart, and POST /cart/validate then re-prices them.
      productId: true,
      productName: true,
      productSlug: true,
      productSku: true,
      productImage: true,
      unitPrice: true,
      unitOldPrice: true,
      quantity: true,
      lineTotal: true,
    },
  },
} satisfies Prisma.OrderSelect;

/** Cancelled orders are history, not money spent. */
const SPENT_STATUSES: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Backing service for the customer's личный кабинет. Every query is scoped to
 * the session's `userId` — the account API never takes an id from the client
 * to decide whose data to return.
 */
@Injectable()
export class AccountService {
  constructor(
    private prisma: PrismaService,
    private promo: PromoService,
    private auth: AuthService,
  ) {}

  /** The "Общая информация" section: profile plus the figures above it. */
  async getSummary(userId: string) {
    const [user, orders, spent, lastOrder, promoCodes] = await Promise.all([
      this.auth.getProfile(userId),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        where: { userId, status: { in: SPENT_STATUSES } },
        _sum: { total: true },
      }),
      this.prisma.order.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          createdAt: true,
        },
      }),
      this.promo.listAvailable(),
    ]);

    const byStatus = Object.fromEntries(
      orders.map((row) => [row.status, row._count._all]),
    ) as Partial<Record<OrderStatus, number>>;

    return {
      user,
      orders: {
        total: orders.reduce((sum, row) => sum + row._count._all, 0),
        byStatus,
        // Rounded here because floating-point sums of 2-decimal prices drift.
        totalSpent: Math.round((spent._sum.total ?? 0) * 100) / 100,
        last: lastOrder,
      },
      promoCodes: { available: promoCodes.data.length },
    };
  }

  /** The "История заказов" section. */
  async listOrders(userId: string, query: AccountOrderQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const where: Prisma.OrderWhereInput = { userId };
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: ORDER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
  }

  /**
   * One order, scoped to its owner: an id belonging to someone else is a 404,
   * not a 403 — it must not confirm that the order exists.
   */
  async getOrder(userId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      select: ORDER_SELECT,
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  /** The "Доступные промокоды" section. */
  listPromoCodes() {
    return this.promo.listAvailable();
  }
}
