import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DeliveryMethod, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  AdminOrderQueryDto,
  AdminUpdateOrderStatusDto,
} from './dto/admin-order-query.dto';
import { PromoService } from '../promo/promo.service';
import { TelegramService } from '../notifications/telegram.service';
import { MailService } from '../notifications/mail.service';
import {
  buildCustomerOrderMail,
  buildOrderMail,
} from '../notifications/order-mail';
import { resolvePayer } from './order-payer';
import { attributionColumns } from '../attribution/traffic-source';
import { SellerService } from '../b2b/seller.service';
import { ServerCartService } from '../cart/server-cart.service';
import { withoutPlaceholderImages } from '../common/utils/product-images';
import { MAX_LINE_QUANTITY } from '../cart/cart-limits';

const DEFAULT_CURRENCY = 'BYN';
const MAX_INT4 = 2_147_483_647;

/**
 * Who placed the order, when it came from an account. Admin-only: the public
 * confirmation and the customer's own history never need it.
 */
const ORDER_ACCOUNT_SELECT = {
  select: {
    id: true,
    login: true,
    name: true,
    customerType: true,
    companyName: true,
  },
} satisfies Prisma.OrderInclude['user'];

const PAYER_ACCOUNT_SELECT = {
  customerType: true,
  companyName: true,
  taxId: true,
  legalAddress: true,
  bankAccount: true,
  bankName: true,
  bankBic: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private promo: PromoService,
    private telegram: TelegramService,
    private serverCart: ServerCartService,
    private mail: MailService,
    @Optional() private seller?: SellerService,
  ) {}

  private deliveryCost(method: DeliveryMethod): number {
    switch (method) {
      case 'COURIER':
        return Number(process.env.DELIVERY_COST_COURIER ?? 15);
      case 'POST':
        return Number(process.env.DELIVERY_COST_POST ?? 10);
      case 'PICKUP':
      default:
        return 0;
    }
  }

  /**
   * `userId` is passed only when the checkout request carried a session; guest
   * orders keep it null. It is the sole way an order joins «История заказов».
   */
  async createOrder(dto: CreateOrderDto, userId?: string) {
    // Collapse duplicate productIds into summed quantities, capped like a
    // single line (and like POST /cart/validate, so the totals agree).
    const quantities = new Map<string, number>();
    for (const item of dto.items) {
      quantities.set(
        item.productId,
        Math.min(
          MAX_LINE_QUANTITY,
          (quantities.get(item.productId) ?? 0) + item.quantity,
        ),
      );
    }

    const productIds = [...quantities.keys()];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, status: 'PUBLISHED' },
      include: { images: { orderBy: { order: 'asc' } } },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    // Validate every requested product is available and priced.
    const orderItems: Prisma.OrderItemCreateWithoutOrderInput[] = [];
    let itemsTotal = 0;
    let currency = DEFAULT_CURRENCY;

    for (const productId of productIds) {
      const product = productById.get(productId);
      if (!product) {
        throw new BadRequestException(
          `Товар недоступен для заказа: ${productId}`,
        );
      }
      if (product.priceValue == null || product.priceValue <= 0) {
        throw new BadRequestException(
          `Цена товара недоступна: ${product.name}`,
        );
      }

      const quantity = quantities.get(productId)!;
      const unitPrice = product.priceValue;
      const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
      itemsTotal += lineTotal;
      if (product.priceCurrency) currency = product.priceCurrency;

      orderItems.push({
        product: { connect: { id: product.id } },
        productName: product.name,
        productSlug: product.slug,
        productSku: product.sku ?? null,
        productImage: withoutPlaceholderImages(product.images)[0]?.url ?? null,
        unitPrice,
        // Only a genuine markdown counts, not a stale oldPrice below the price.
        unitOldPrice:
          product.oldPrice != null && product.oldPrice > unitPrice
            ? product.oldPrice
            : null,
        quantity,
        lineTotal,
      });
    }

    if (
      (dto.deliveryMethod === 'COURIER' || dto.deliveryMethod === 'POST') &&
      !dto.deliveryAddress?.trim()
    ) {
      throw new BadRequestException(
        'Для выбранного способа доставки нужно указать адрес',
      );
    }

    itemsTotal = Math.round(itemsTotal * 100) / 100;

    // Frozen into the order: who the invoice is made out to.
    const account = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: PAYER_ACCOUNT_SELECT,
        })
      : null;
    const payer = resolvePayer(dto, account);

    // Prices are re-parsed from suppliers daily, so a cart restored from
    // localStorage can be stale. When the client tells us what the customer
    // saw, refuse to quietly charge a different amount — the storefront
    // re-validates and asks them to confirm the new total.
    if (
      dto.expectedItemsTotal !== undefined &&
      Math.abs(dto.expectedItemsTotal - itemsTotal) > 0.005
    ) {
      throw new ConflictException({
        message:
          'Цены в корзине изменились. Проверьте заказ и подтвердите ещё раз.',
        code: 'CART_PRICE_CHANGED',
        expectedItemsTotal: dto.expectedItemsTotal,
        actualItemsTotal: itemsTotal,
      });
    }

    let deliveryCost = this.deliveryCost(dto.deliveryMethod);

    // Re-evaluate the promo code against server-side totals; the client's
    // preview is never trusted, same as the line prices above.
    let discountTotal = 0;
    let promoCodeId: string | null = null;
    let promoCodeLabel: string | null = null;
    if (dto.promoCode?.trim()) {
      const promo = await this.promo.evaluate(dto.promoCode, itemsTotal);
      discountTotal = promo.discount;
      promoCodeId = promo.code.id;
      promoCodeLabel = promo.code.code;
      if (promo.freeDelivery) deliveryCost = 0;
    }

    const total =
      Math.round((itemsTotal - discountTotal + deliveryCost) * 100) / 100;

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: userId ?? null,
          customerName: dto.customerName.trim(),
          customerPhone: dto.customerPhone.trim(),
          customerEmail: dto.customerEmail?.trim() || null,
          comment: dto.comment?.trim() || null,
          deliveryMethod: dto.deliveryMethod,
          deliveryAddress: dto.deliveryAddress?.trim() || null,
          paymentMethod: dto.paymentMethod,
          ...payer,
          ...attributionColumns(dto.attribution),
          currency,
          itemsTotal,
          deliveryCost,
          discountTotal,
          total,
          promoCodeId,
          promoCodeLabel,
          items: { create: orderItems },
        },
        include: { items: true },
      });

      if (promoCodeId) {
        // The usage check in evaluate() ran outside this transaction, so N
        // parallel checkouts with a single-use code would all pass it. The
        // conditional increment is the real gate: only one of them gets the
        // row, the rest roll back. Raw SQL because Prisma cannot compare two
        // columns in a where.
        const claimed = await tx.$executeRaw`
          UPDATE "PromoCode"
          SET "usedCount" = "usedCount" + 1, "updatedAt" = NOW()
          WHERE "id" = ${promoCodeId}
            AND "isActive"
            AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
        `;
        if (claimed !== 1) {
          throw new BadRequestException('Промокод исчерпан');
        }
      }

      return created;
    });

    // The stored cart has served its purpose. Same rule as the notification
    // below: the order is already committed, so a failure here is logged and
    // swallowed rather than turned into an error the customer sees.
    if (userId) {
      await this.serverCart.clear(userId).catch((error) => {
        this.logger.warn(
          `Order #${order.number}: could not clear the stored cart: ${String(error)}`,
        );
      });
    }

    // Fire-and-forget: the order is committed, so a failed or slow notification
    // must not delay the response or fail the request. The catch is load-bearing
    // — an unhandled rejection here would take the process down.
    this.telegram.notifyNewOrder(order).catch((error) => {
      this.logger.error(
        `Order #${order.number} notification failed: ${String(error)}`,
      );
    });
    // Same rule for the letter to the shop's mailbox (MAIL_ADMIN_TO). Built
    // inside the promise so even a throw while composing it is caught here.
    const publicOrigin = process.env.PUBLIC_ORIGIN?.replace(/\/$/, '');
    Promise.resolve()
      .then(() =>
        this.mail.sendToAdmins(
          buildOrderMail(order, publicOrigin),
          `order #${order.number}`,
        ),
      )
      .catch((error) => {
        this.logger.error(
          `Order #${order.number} mail failed: ${String(error)}`,
        );
      });
    // And a copy for the customer: a purchaser attaches it to the request in
    // their own accounting. Same never-throw rule.
    if (order.customerEmail) {
      const to = order.customerEmail;
      Promise.resolve()
        .then(async () => {
          // A company paying by invoice gets the PDF link straight away —
          // when the seller's requisites are complete.
          const invoiceUrl =
            publicOrigin &&
            order.paymentMethod === 'INVOICE' &&
            order.payerName &&
            (await this.seller?.invoiceReady())
              ? `${publicOrigin}/api/orders/${order.id}/invoice.pdf`
              : undefined;
          return this.mail.send(
            {
              to,
              ...buildCustomerOrderMail(order, publicOrigin, invoiceUrl),
            },
            `order #${order.number} to customer`,
          );
        })
        .catch((error) => {
          this.logger.error(
            `Order #${order.number} customer mail failed: ${String(error)}`,
          );
        });
    }

    return order;
  }

  /**
   * Public order confirmation, looked up by unguessable UUID (order numbers are
   * sequential, so they must not be queryable). Projects out PII that isn't
   * needed on the confirmation page (phone, email, comment).
   */
  async getOrderConfirmation(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: {
        number: true,
        status: true,
        currency: true,
        itemsTotal: true,
        deliveryCost: true,
        discountTotal: true,
        promoCodeLabel: true,
        total: true,
        deliveryMethod: true,
        deliveryAddress: true,
        paymentMethod: true,
        // The success page offers the PDF invoice to a company buyer.
        payerName: true,
        customerName: true,
        createdAt: true,
        items: {
          select: {
            id: true,
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
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  async getOrders(query: AdminOrderQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      const search = query.search.trim();
      const or: Prisma.OrderWhereInput[] = [
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { payerName: { contains: search, mode: 'insensitive' } },
        { payerTaxId: { contains: search.replace(/\s/g, '') } },
        { trafficSource: { contains: search, mode: 'insensitive' } },
      ];
      // Order numbers are INT4: a phone number typed into the same box would
      // overflow it and fail the whole query.
      const asNumber = Number(search.replace(/[^0-9]/g, ''));
      if (Number.isInteger(asNumber) && asNumber > 0 && asNumber <= MAX_INT4) {
        or.push({ number: asNumber });
      }
      where.OR = or;
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { items: true, user: ORDER_ACCOUNT_SELECT },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, user: ORDER_ACCOUNT_SELECT },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  /**
   * Forward moves (skipping steps is fine) and cancellation of an active
   * order. DELIVERED and CANCELLED are final: reopening a cancelled order
   * would also have to re-claim its promo use and re-check its prices. The
   * storefront only ever offered these moves; the API now enforces them.
   *
   * Cancelling gives the promo use back, so a single-use code is not burnt
   * by an order that never happened.
   */
  async updateStatus(id: string, dto: AdminUpdateOrderStatusDto) {
    const order = await this.getOrder(id);
    if (order.status === dto.status) return order;
    if (!canMoveOrder(order.status, dto.status)) {
      throw new BadRequestException(
        `Нельзя перевести заказ из «${order.status}» в «${dto.status}»`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      // Conditional on the status the check above saw: two cancels at once
      // (the order modal and the account page, two admins) both passed the
      // check, and both gave the promo use back; a DELIVERED order could be
      // overwritten by a stale «cancel».
      const moved = await tx.order.updateMany({
        where: { id, status: order.status },
        data: { status: dto.status },
      });
      if (moved.count === 0) {
        throw new ConflictException(
          'Статус заказа уже изменился — обновите страницу',
        );
      }
      const updated = await tx.order.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });
      if (dto.status === OrderStatus.CANCELLED && order.promoCodeId) {
        await tx.$executeRaw`
          UPDATE "PromoCode" SET "usedCount" = GREATEST("usedCount" - 1, 0)
          WHERE "id" = ${order.promoCodeId}`;
      }
      return updated;
    });
  }
}

const ORDER_FLOW: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

/** Pure, so the rule is tested without a database. */
export function canMoveOrder(from: OrderStatus, to: OrderStatus): boolean {
  if (from === OrderStatus.DELIVERED || from === OrderStatus.CANCELLED) {
    return false;
  }
  if (to === OrderStatus.CANCELLED) return true;
  return ORDER_FLOW.indexOf(to) > ORDER_FLOW.indexOf(from);
}
