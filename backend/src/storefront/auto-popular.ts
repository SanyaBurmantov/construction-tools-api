/**
 * «Популярное у организаций» when nobody curated the row: what people
 * actually wanted, then a fill from the biggest departments. Pure, tested.
 *
 * Why not Metrika: with robots left out it hides every URL below its privacy
 * threshold (0 product rows), and with robots in the top is crawler noise —
 * a glass salad bowl at an address that was never ours. Our own signals are
 * people only: orders, carts, a click from search results, a visit counted
 * by our script.
 */

export type PopularSignal = {
  productId: string;
  rootId: string;
  score: number;
};

/** Points per signal: an order says most, a page view least. */
export const SIGNAL_WEIGHTS = {
  order: 5,
  cart: 3,
  searchClick: 2,
  visitor: 1,
} as const;

/**
 * The row: products with a signal first, best score first, then the fill —
 * one product of each department in turn, biggest department first. At most
 * `perRoot` from one department, so a busy one cannot take the whole row.
 */
export function composePopularRow(
  signals: PopularSignal[],
  fill: Map<string, string[]>,
  rootOrder: string[],
  limit = 10,
  perRoot = 2,
): string[] {
  const row: string[] = [];
  const taken = new Set<string>();
  const perRootCount = new Map<string, number>();
  const add = (productId: string, rootId: string) => {
    if (row.length >= limit || taken.has(productId)) return false;
    if ((perRootCount.get(rootId) ?? 0) >= perRoot) return false;
    row.push(productId);
    taken.add(productId);
    perRootCount.set(rootId, (perRootCount.get(rootId) ?? 0) + 1);
    return true;
  };

  for (const signal of [...signals].sort((a, b) => b.score - a.score)) {
    if (signal.score > 0) add(signal.productId, signal.rootId);
  }

  // Round-robin over the departments: everyone gets one before anyone two.
  for (let round = 0; row.length < limit && round < perRoot; round++) {
    for (const rootId of rootOrder) {
      const candidates = fill.get(rootId) ?? [];
      for (const productId of candidates) {
        if (add(productId, rootId)) break;
      }
      if (row.length >= limit) break;
    }
  }
  return row;
}
