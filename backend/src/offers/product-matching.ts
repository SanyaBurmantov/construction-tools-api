/**
 * Pure product-identity logic: normalizing the fields suppliers disagree about
 * and deciding how confident we are that two listings are the same item.
 *
 * No database access, so the rules that decide whether two catalogue entries
 * get merged are directly testable.
 */

export type MatchSignal = 'barcode' | 'sku' | 'model' | 'name';

export type MatchConfidence = 'exact' | 'strong' | 'likely' | 'weak';

export type MatchCandidate = {
  signal: MatchSignal;
  confidence: MatchConfidence;
  /** 0..1, used to rank suggestions in the admin queue. */
  score: number;
};

export type ProductIdentity = {
  id: string;
  name: string;
  brandName?: string | null;
  sku?: string | null;
  barcode?: string | null;
  model?: string | null;
};

/**
 * Suppliers write article numbers every possible way: "DF-333 D", "df333d",
 * "DF333/D". Strip everything that isn't alphanumeric and upper-case.
 */
export function normalizeCode(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^0-9a-zA-Zа-яА-ЯёЁ]/g, '').toUpperCase();
  // Two characters can't identify a product; treating "1" as an SKU would
  // merge unrelated items.
  return normalized.length >= 3 ? normalized : null;
}

/** Barcodes are digits only; EAN-13/UPC lengths are the ones worth trusting. */
export function normalizeBarcode(value?: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  // All-zero or repeated-digit placeholders show up in supplier feeds.
  if (/^(\d)\1+$/.test(digits)) return null;
  return digits;
}

export function normalizeBrand(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^0-9a-zа-яё]/gi, '')
    .trim();
  return normalized || null;
}

const NOISE_WORDS = new Set([
  'шт',
  'уп',
  'новинка',
  'акция',
  'хит',
  'распродажа',
  'арт',
  'артикул',
  'модель',
]);

/**
 * Reduces a product title to comparable tokens: lower-cased, punctuation
 * dropped, marketing noise removed, tokens sorted so word order stops mattering.
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/gi, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !NOISE_WORDS.has(token))
    .sort()
    .join(' ');
}

/** Jaccard similarity over name tokens — cheap and good enough to rank. */
export function nameSimilarity(a: string, b: string): number {
  const left = new Set(normalizeName(a).split(' ').filter(Boolean));
  const right = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** The three keys stored on Product for fast candidate lookup. */
export function buildMatchKeys(product: ProductIdentity) {
  const brand = normalizeBrand(product.brandName);
  const sku = normalizeCode(product.sku);
  const model = normalizeCode(product.model);

  return {
    matchBarcode: normalizeBarcode(product.barcode),
    // An article number is only identifying together with its brand: two
    // suppliers can both sell an "SKU 1000" from different manufacturers.
    matchSku: brand && sku ? `${brand}:${sku}` : null,
    matchModel: brand && model ? `${brand}:${model}` : null,
  };
}

/** Similarity above which two names are worth suggesting to a human. */
export const NAME_SUGGEST_THRESHOLD = 0.72;

/**
 * Compares two products and reports the strongest signal they share.
 *
 * Only `exact` and `strong` are safe to merge automatically — everything else
 * goes to the admin queue, because a wrong merge is expensive to undo.
 */
export function compareProducts(
  a: ProductIdentity,
  b: ProductIdentity,
): MatchCandidate | null {
  if (a.id === b.id) return null;

  const keysA = buildMatchKeys(a);
  const keysB = buildMatchKeys(b);

  if (keysA.matchBarcode && keysA.matchBarcode === keysB.matchBarcode) {
    return { signal: 'barcode', confidence: 'exact', score: 1 };
  }

  if (keysA.matchSku && keysA.matchSku === keysB.matchSku) {
    return { signal: 'sku', confidence: 'strong', score: 0.92 };
  }

  if (keysA.matchModel && keysA.matchModel === keysB.matchModel) {
    // Model numbers are reused across variants far more often than SKUs, so a
    // model match alone is a suggestion, not a merge.
    return { signal: 'model', confidence: 'likely', score: 0.8 };
  }

  const similarity = nameSimilarity(a.name, b.name);
  if (similarity >= NAME_SUGGEST_THRESHOLD) {
    const sameBrand =
      normalizeBrand(a.brandName) !== null &&
      normalizeBrand(a.brandName) === normalizeBrand(b.brandName);
    // Different brands with similar names are usually genuinely different
    // products ("дрель ударная 750 Вт" from two manufacturers).
    if (!sameBrand && (a.brandName || b.brandName)) return null;

    return {
      signal: 'name',
      confidence: 'weak',
      score: Number(similarity.toFixed(2)),
    };
  }

  return null;
}

export function isAutoMergeable(candidate: MatchCandidate): boolean {
  return candidate.confidence === 'exact' || candidate.confidence === 'strong';
}
