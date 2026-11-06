import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CustomerType,
  OrderStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  AdminOrderQueryDto,
  AdminUpdateOrderStatusDto,
} from './dto/admin-order-query.dto';
import { PromoService } from '../promo/promo.service';
import { resolvePayer } from './order-payer';
import { PayerRegistryService } from '../requisites/payer-registry.service';
import { deliveryCostFor, orderMinimum, orderTerms } from './order-terms';
import { attributionColumns } from '../attribution/traffic-source';
import { OrderNotificationsService } from './order-notifications.service';
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
    private serverCart: ServerCartService,
    @Optional() private notifications?: OrderNotificationsService,
    @Optional() private payerRegistry?: PayerRegistryService,
  ) {}

  /**
   * `userId` is passed only when the checkout request carried a session; guest
   * orders keep it null. It is the sole way an order joins «История заказов».
   */
  async createOrder(dto: CreateOrderDto, userId?: string) {
    // A retry of a checkout that already went through (the response was lost,
    // the button pressed twice) answers that order instead of a second one.
    const idempotencyKey = dto.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(idempotencyKey, userId);
      if (existing) return existing;
    }

    // Collapse duplicate productIds into summed quantities, capped like a
    // single line (and like POST /cart/validate, so the totals agree).
    const quantities = new Map<string, number>();
    // The first line that names a block wins for a product listed twice.
    const upsell = new Map<string, string>();
    for (const item of dto.items) {
      if (item.upsellSource && !upsell.has(item.productId))
        upsell.set(item.productId, item.upsellSource);
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
        upsellSource: upsell.get(product.id) ?? null,
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
    // Organisations and ИП only, by invoice (owner, 2026-11-06): a manager
    // makes the invoice out to the payer, whose УНП the tax registry knows.
    if (dto.paymentMethod !== PaymentMethod.INVOICE) {
      throw new BadRequestException(
        'Сайт работает только с организациями и ИП — оплата по счёту. Розничные покупки — в магазине или по телефону',
      );
    }
    const payer = resolvePayer(dto, account);
    await this.payerRegistry?.assertBillable(payer.payerTaxId);

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

    // The terms of sale (order-terms.ts): an organisation — an order with a
    // payer — has its own minimum and free delivery from a threshold.
    const terms = orderTerms();
    const isCompany = payer.payerType === CustomerType.COMPANY;
    const minimum = orderMinimum(terms, isCompany);
    if (itemsTotal < minimum) {
      throw new BadRequestException({
        message: isCompany
          ? `Минимальная сумма заказа для организаций — ${minimum} BYN`
          : `Минимальная сумма заказа — ${minimum} BYN. Организации заказывают по безналичному расчёту от ${terms.minCompany} BYN`,
        code: 'ORDER_MINIMUM',
        minimum,
      });
    }

    // Re-evaluate the promo code against server-side totals; the client's
    // preview is never trusted, same as the line prices above.
    let discountTotal = 0;
    let promoCodeId: string | null = null;
    let promoCodeLabel: string | null = null;
    let promoFreeDelivery = false;
    if (dto.promoCode?.trim()) {
      const promo = await this.promo.evaluate(dto.promoCode, itemsTotal);
      discountTotal = promo.discount;
      promoCodeId = promo.code.id;
      promoCodeLabel = promo.code.code;
      promoFreeDelivery = promo.freeDelivery;
    }
    const deliveryCost = promoFreeDelivery
      ? 0
      : deliveryCostFor(
          terms,
          dto.deliveryMethod,
          isCompany,
          itemsTotal - discountTotal,
        );

    const total =
      Math.round((itemsTotal - discountTotal + deliveryCost) * 100) / 100;

    let order: Prisma.OrderGetPayload<{ include: { items: true } }>;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            idempotencyKey,
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

        // Committed together with the order or not at all (transactional
        // outbox): the notifications can no longer be lost to a restart.
        if (this.notifications) await this.notifications.enqueue(tx, created);

        return created;
      });
    } catch (error) {
      // Two copies of one attempt raced past the lookup above: the loser hits
      // the unique key and answers the winner's order.
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findByIdempotencyKey(
          idempotencyKey,
          userId,
        );
        if (existing) return existing;
      }
      throw error;
    }

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

    // The API's immediate attempt; whatever it cannot send now the worker
    // retries from the outbox (order-notifications.service.ts). Fire-and-
    // forget and never throws: the order is committed, a slow Telegram or
    // SMTP must not delay the response.
    void this.notifications?.deliverForOrder(order.id);

    return order;
  }

  /**
   * The order an earlier attempt with this key created. Only for the same
   * caller: a key replayed from another account (or a guest replaying an
   * account's key) is refused rather than handed someone else's order.
   */
  private async findByIdempotencyKey(key: string, userId?: string) {
    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey: key },
      include: { items: true },
    });
    if (!existing) return null;
    if ((existing.userId ?? null) !== (userId ?? null)) {
      throw new ConflictException({
        message: 'Этот заказ уже оформлен из другого аккаунта',
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    }
    return existing;
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
