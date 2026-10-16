/**
 * Pure choice of the offer a product is priced from — no database, so both
 * OffersService (after a parse) and PricingService (bulk recalculation) use
 * the same rule without depending on each other.
 *
 * In-stock offers win outright: a cheaper offer nobody can fulfil is not a
 * real price. Falls back to the cheapest offer of any kind so a fully
 * out-of-stock product still has a cost to price from.
 */

export type OfferRow = {
  price: number | null;
  stock: boolean;
  specifications: unknown;
};

export type BestOffer = {
  price: number;
  /** The supplier's own "was" price, when it advertises a discount. */
  oldPrice: number | null;
  stockStatus: 'in_stock' | 'preorder' | 'out_of_stock' | 'unknown';
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export function pickBestOffer(rows: OfferRow[]): BestOffer | null {
  const offers = rows.filter(
    (offer): offer is OfferRow & { price: number } =>
      offer.price != null && offer.price > 0,
  );
  if (!offers.length) return null;

  const inStock = offers.filter((offer) => offer.stock);
  const pool = inStock.length ? inStock : offers;
  const offer = pool.reduce((best, item) =>
    item.price < best.price ? item : best,
  );

  const metadata = asRecord(asRecord(offer.specifications)?.source);
  const oldPrice = metadata?.oldPrice;
  const availability = metadata?.stockStatus ?? metadata?.inStock;
  const stockStatus: BestOffer['stockStatus'] = offer.stock
    ? 'in_stock'
    : availability === 'preorder'
      ? 'preorder'
      : availability === false || availability === 'out_of_stock'
        ? 'out_of_stock'
        : 'unknown';

  return {
    price: offer.price,
    oldPrice:
      typeof oldPrice === 'number' && Number.isFinite(oldPrice)
        ? oldPrice
        : null,
    stockStatus,
  };
}
