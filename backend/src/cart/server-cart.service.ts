import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { withoutPlaceholderImages } from '../common/utils/product-images';
import { CartItemsDto } from './dto/server-cart.dto';

/** One line as the storefront needs it: identity, quantity and a live price. */
export type ServerCartLine = {
  productId: string;
  slug: string;
  name: string;
  sku: string | null;
  image: string | null;
  price: number | null;
  oldPrice: number | null;
  currency: string;
  stockStatus: string | null;
  quantity: number;
};

/** A line that could not be kept, and why — the client shows this once. */
export type DroppedCartLine = {
  productId: string;
  name: string | null;
  reason: 'unavailable';
};

export type ServerCart = {
  items: ServerCartLine[];
  dropped: DroppedCartLine[];
  updatedAt: Date | null;
};

const MAX_QUANTITY = 999;
const DEFAULT_TTL_DAYS = 90;

/**
 * The account's cart, stored server-side.
 *
 * Three rules make this safe to layer onto the existing localStorage cart:
 *
 * 1. **Only identity and quantity are stored.** Prices are read from `Product`
 *    whenever the cart is served, so a row can never resurrect an old price —
 *    the same reason `OrderItem` snapshots prices and this does not.
 * 2. **The client cart stays the one the UI renders.** This is a backup:
 *    merged into the local cart on sign-in, overwritten from it on change.
 *    Guests are unaffected, and a sync failure costs nothing.
 * 3. **Merging takes the larger quantity, never the sum.** Summing looks
 *    reasonable until the same cart syncs twice (two tabs, a re-login, an
 *    offline edit) and every line silently doubles.
 */
@Injectable()
export class ServerCartService {
  private readonly logger = new Logger(ServerCartService.name);

  constructor(private prisma: PrismaService) {}

  /** Collapses duplicate ids and clamps quantities, as createOrder does. */
  private normalize(dto: CartItemsDto): Map<string, number> {
    const quantities = new Map<string, number>();
    for (const item of dto.items) {
      const next = (quantities.get(item.productId) ?? 0) + item.quantity;
      quantities.set(item.productId, Math.min(next, MAX_QUANTITY));
    }
    return quantities;
  }

  /**
   * Which of these ids may be in a cart at all. Everything else is reported as
   * dropped: an unpublished or deleted product must not sit in a cart that is
   * then restored on another device weeks later.
   */
  private async orderableProducts(productIds: string[]) {
    if (!productIds.length) return new Map<string, { id: string }>();
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, status: 'PUBLISHED' },
      select: { id: true },
    });
    return new Map(products.map((product) => [product.id, product]));
  }

  async getCart(userId: string): Promise<ServerCart> {
    const rows = await this.prisma.cartItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        product: {
          include: { images: { orderBy: { order: 'asc' } } },
        },
      },
    });

    const items: ServerCartLine[] = [];
    const dropped: DroppedCartLine[] = [];
    const staleIds: string[] = [];

    for (const row of rows) {
      const product = row.product;
      if (product.status !== 'PUBLISHED') {
        dropped.push({
          productId: row.productId,
          name: product.name,
          reason: 'unavailable',
        });
        staleIds.push(row.productId);
        continue;
      }

      items.push({
        productId: product.id,
        slug: product.slug,
        name: product.name,
        sku: product.sku,
        image: withoutPlaceholderImages(product.images)[0]?.url ?? null,
        price: product.priceValue,
        oldPrice:
          product.oldPrice != null &&
          product.priceValue != null &&
          product.oldPrice > product.priceValue
            ? product.oldPrice
            : null,
        currency: product.priceCurrency ?? 'BYN',
        stockStatus: product.stockStatus,
        quantity: row.quantity,
      });
    }

    // Tidy up as we go: a line we refuse to serve should not be stored either.
    if (staleIds.length) {
      await this.prisma.cartItem
        .deleteMany({ where: { userId, productId: { in: staleIds } } })
        .catch(() => undefined);
    }

    const updatedAt = rows.reduce<Date | null>(
      (latest, row) =>
        !latest || row.updatedAt > latest ? row.updatedAt : latest,
      null,
    );

    return { items, dropped, updatedAt };
  }

  /**
   * Makes the stored cart exactly what the client sent. This is the sync
   * direction used after every local change: last write wins, which is the
   * honest contract for a cart edited on one device at a time.
   */
  async replace(userId: string, dto: CartItemsDto): Promise<ServerCart> {
    const quantities = this.normalize(dto);
    const orderable = await this.orderableProducts([...quantities.keys()]);

    const data: Prisma.CartItemCreateManyInput[] = [];
    for (const [productId, quantity] of quantities) {
      if (orderable.has(productId)) data.push({ userId, productId, quantity });
    }

    await this.prisma.$transaction([
      this.prisma.cartItem.deleteMany({ where: { userId } }),
      ...(data.length
        ? [this.prisma.cartItem.createMany({ data, skipDuplicates: true })]
        : []),
    ]);

    return this.getCart(userId);
  }

  /**
   * Union of the stored cart and the one in the browser, used once per
   * sign-in: what was picked as a guest is added to what the account already
   * had, and a product in both keeps the larger quantity (see the class note
   * on why not the sum).
   */
  async merge(userId: string, dto: CartItemsDto): Promise<ServerCart> {
    const incoming = this.normalize(dto);

    if (incoming.size) {
      const existing = await this.prisma.cartItem.findMany({
        where: { userId },
        select: { productId: true, quantity: true },
      });
      const existingQuantity = new Map(
        existing.map((row) => [row.productId, row.quantity]),
      );
      const orderable = await this.orderableProducts([...incoming.keys()]);

      const writes: Prisma.PrismaPromise<unknown>[] = [];
      for (const [productId, quantity] of incoming) {
        if (!orderable.has(productId)) continue;
        const current = existingQuantity.get(productId);
        if (current == null) {
          writes.push(
            this.prisma.cartItem.create({
              data: { userId, productId, quantity },
            }),
          );
        } else if (quantity > current) {
          writes.push(
            this.prisma.cartItem.update({
              where: { userId_productId: { userId, productId } },
              data: { quantity },
            }),
          );
        }
      }
      if (writes.length) await this.prisma.$transaction(writes);
    }

    return this.getCart(userId);
  }

  async clear(userId: string) {
    const { count } = await this.prisma.cartItem.deleteMany({
      where: { userId },
    });
    return { ok: true, removed: count };
  }

  /**
   * Called by the cleanup cron. A cart nobody has touched for months is not a
   * cart any more, and without this the table only ever grows.
   */
  async purgeStale() {
    const days = Number(process.env.CART_TTL_DAYS);
    const ttlDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS;
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.cartItem.deleteMany({
      where: { updatedAt: { lte: cutoff } },
    });
    if (count) this.logger.log(`Removed ${count} stale cart line(s)`);
    return count;
  }
}
