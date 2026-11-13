/**
 * The price an offer row should store after a parse of the supplier's page.
 *
 * - The page shows a price — that price.
 * - No price, and the page says the item is out of stock — `null`: the
 *   supplier no longer quotes it. Writing the parsed `undefined` left the
 *   stored price untouched (Prisma skips undefined), so the offer kept its
 *   last price and the product stayed on sale at it.
 * - No price, but in stock or stock unknown — `undefined`, the stored price
 *   stays. That combination is far more often a price block the supplier
 *   redesigned (a selector that no longer matches) than a real «цена по
 *   запросу», and nulling it would take a whole catalogue off sale in one
 *   batch. The batch's other signals (failure rate) catch a broken parser.
 * - The page says the price is on request («Цена: уточняйте», a marker the
 *   parser recognised, not a missing selector) — `null`: the supplier quotes
 *   no price, and whatever number sits in its hidden price block (dukon.by's
 *   «1 руб.» placeholder) is not one. Wins over a parsed price.
 */
export function offerPrice(
  price: number | null | undefined,
  outOfStock: boolean,
  priceOnRequest = false,
): number | null | undefined {
  if (priceOnRequest) return null;
  if (price != null && Number.isFinite(price) && price > 0) return price;
  return outOfStock ? null : undefined;
}
