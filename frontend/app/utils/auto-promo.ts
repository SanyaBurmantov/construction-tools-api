/** Only what the choice needs — `PromoCodeOffer` satisfies it. */
export interface AutoPromoCandidate {
  code: string
  type: 'PERCENT' | 'FIXED'
  value: number
  minOrderTotal: number | null
}

/**
 * The advertised promo code worth the most on this cart, or null — what the
 * cart applies by itself when no code is applied. Codes whose minimum the cart
 * does not reach are skipped (validating them would only spend the throttled
 * validate endpoint on a sure refusal), codes the customer took off by hand
 * are never chosen, and a fixed amount is capped by the cart as the server
 * caps it.
 */
export function pickAutoPromo<T extends AutoPromoCandidate>(
  offers: readonly T[],
  itemsTotal: number,
  dismissed: readonly string[] = []
): T | null {
  let best: T | null = null
  let bestValue = 0
  for (const offer of offers) {
    if (dismissed.includes(offer.code)) continue
    if (offer.minOrderTotal != null && itemsTotal < offer.minOrderTotal) continue
    const value = offer.type === 'PERCENT' ? (itemsTotal * offer.value) / 100 : Math.min(offer.value, itemsTotal)
    if (value > bestValue) {
      best = offer
      bestValue = value
    }
  }
  return best
}
