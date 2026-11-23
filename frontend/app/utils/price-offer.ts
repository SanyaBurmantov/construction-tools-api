/**
 * The supplier offer the storefront price comes from — the same rule as the
 * backend's `pickBestOffer` (`backend/src/offers/best-offer.ts`): the most
 * expensive offer in stock, or the most expensive of all when none is in
 * stock (owner, 2026-11-23). Used to say «цена отсюда» next to it in the
 * admin's supplier notes. Change both together.
 */
export function pickPriceOffer<T extends { price: number | null, stock: boolean }>(
  offers: T[],
): T | null {
  const priced = offers.filter(offer => offer.price != null && offer.price > 0)
  const inStock = priced.filter(offer => offer.stock)
  const pool = inStock.length ? inStock : priced
  return pool.reduce<T | null>(
    (best, offer) => (!best || offer.price! > best.price! ? offer : best),
    null,
  )
}
