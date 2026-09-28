import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValidateCartDto } from './dto/validate-cart.dto';

/** Why a cart line can't be ordered as-is. `null` means the line is fine. */
export type CartIssue =
  | 'unavailable'
  | 'price_changed'
  | 'price_missing'
  | 'out_of_stock';

export type ValidatedCartItem = {
  productId: string;
  quantity: number;
  issue: CartIssue | null;
  /** What the client showed, echoed back so the UI can render "was → now". */
  clientPrice: number | null;
  price: number | null;
  oldPrice: number | null;
  currency: string;
  name: string | null;
  slug: string | null;
  image: string | null;
  stockStatus: string | null;
  lineTotal: number;
};

const round = (value: number) => Math.round(value * 100) / 100;
/** Prices are money with 2 decimals; anything smaller is float noise. */
const PRICE_EPSILON = 0.005;

@Injectable()
export class CartService {
  constructor(private prisma: PrismaService) {}

  /**
   * Re-prices a client-side cart against the database.
   *
   * Supplier prices are re-parsed daily, so a cart restored from localStorage
   * can be days out of date. This lets the storefront show "the price changed"
   * before the customer commits, instead of the order silently costing a
   * different amount than the cart displayed.
   */
  async validate(dto: ValidateCartDto) {
    // Collapse duplicates the same way createOrder does, so the totals here
    // match what an order would actually charge.
    const quantities = new Map<string, number>();
    const clientPrices = new Map<string, number | null>();
    for (const item of dto.items) {
      quantities.set(
        item.productId,
        Math.min((quantities.get(item.productId) ?? 0) + item.quantity, 999),
      );
      if (!clientPrices.has(item.productId)) {
        clientPrices.set(item.productId, item.price ?? null);
      }
    }

    const productIds = [...quantities.keys()];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { images: { orderBy: { order: 'asc' }, take: 1 } },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    let itemsTotal = 0;
    let currency = 'BYN';

    const items: ValidatedCartItem[] = productIds.map((productId) => {
      const product = productById.get(productId);
      const quantity = quantities.get(productId)!;
      const clientPrice = clientPrices.get(productId) ?? null;

      // Gone or unpublished — nothing left to price.
      if (!product || product.status !== 'PUBLISHED') {
        return {
          productId,
          quantity,
          issue: 'unavailable',
          clientPrice,
          price: null,
          oldPrice: null,
          currency,
          name: product?.name ?? null,
          slug: product?.slug ?? null,
          image: null,
          stockStatus: null,
          lineTotal: 0,
        };
      }

      if (product.priceCurrency) currency = product.priceCurrency;

      const price = product.priceValue;
      let issue: CartIssue | null = null;

      if (price == null || price <= 0) {
        issue = 'price_missing';
      } else if (
        clientPrice != null &&
        Math.abs(clientPrice - price) > PRICE_EPSILON
      ) {
        issue = 'price_changed';
      } else if (product.stockStatus === 'out_of_stock') {
        // Not a blocker — the shop accepts backorders — but worth surfacing.
        issue = 'out_of_stock';
      }

      const lineTotal = price != null ? round(price * quantity) : 0;
      itemsTotal += lineTotal;

      return {
        productId,
        quantity,
        issue,
        clientPrice,
        price,
        oldPrice:
          product.oldPrice != null && price != null && product.oldPrice > price
            ? product.oldPrice
            : null,
        currency: product.priceCurrency ?? currency,
        name: product.name,
        slug: product.slug,
        image: product.images[0]?.url ?? null,
        stockStatus: product.stockStatus,
        lineTotal,
      };
    });

    const blocking = items.filter(
      (item) => item.issue === 'unavailable' || item.issue === 'price_missing',
    );
    const changed = items.filter((item) => item.issue === 'price_changed');

    return {
      items,
      itemsTotal: round(itemsTotal),
      currency,
      /** True when every line can be ordered as-is. */
      ok: items.every((item) => item.issue === null),
      hasBlocking: blocking.length > 0,
      hasPriceChanges: changed.length > 0,
    };
  }
}
