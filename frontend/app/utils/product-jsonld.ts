/**
 * Pieces of the product page's JSON-LD (`pages/product/[slug].vue`) that are
 * worth a test of their own.
 */

/** Prices are re-read daily; an offer is promised for a week from the last read. */
export const PRICE_VALID_DAYS = 7

/**
 * `Offer.priceValidUntil` — the last sync of the supplier's price + 7 days,
 * as `YYYY-MM-DD`, or `undefined` when that day is today or already past.
 *
 * The field is optional, and a date in the past makes Google treat the offer
 * as expired and drop the product snippet: tens of thousands of cards whose
 * supplier is not being parsed right now carried such dates (SEO audit,
 * 12.11). A fresh date is not invented for them either — the field is left
 * out.
 */
export function priceValidUntil(
  checkedAt: Date | string | null | undefined,
  now: number = Date.now(),
  days: number = PRICE_VALID_DAYS,
): string | undefined {
  if (!checkedAt) return undefined
  const checked = checkedAt instanceof Date ? checkedAt.getTime() : Date.parse(checkedAt)
  if (!Number.isFinite(checked)) return undefined
  const until = new Date(checked + days * 86_400_000).toISOString().slice(0, 10)
  // A date that is today expires while the cached page is still served.
  if (until <= new Date(now).toISOString().slice(0, 10)) return undefined
  return until
}

/** Long enough for any real product text, short enough not to bloat every page twice (HTML + JSON-LD). */
export const JSONLD_DESCRIPTION_MAX = 1000

/**
 * `Product.description`: the product text with whitespace collapsed, cut at
 * the last sentence end before `max` (or at a word, with «…», when no
 * sentence ends in the second half). Some supplier texts run to thousands of
 * characters — one arrives repeated four times (4 747 characters) — and all
 * of it went into the JSON-LD.
 */
export function jsonLdDescription(text: string | null | undefined, max: number = JSONLD_DESCRIPTION_MAX): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean

  const head = clean.slice(0, max)
  let sentenceEnd = -1
  for (const match of head.matchAll(/[.!?…](?=\s|$)/g)) sentenceEnd = match.index
  if (sentenceEnd >= max / 2) return head.slice(0, sentenceEnd + 1)

  const cut = head.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  const words = space > max * 0.6 ? cut.slice(0, space) : cut
  return `${words.replace(/[\s,;:–—-]+$/u, '')}…`
}
