/**
 * Product addresses that were never ours but get visited anyway.
 *
 * Metrika (2026-11-05) showed ~250 different `/product/…` 404s, almost all
 * from robots: `clbc121201-remkomplekt-dlya-treshchotok-cjhm1228-toptul` —
 * the article first, then the name in another transliteration (kh / ts / yy),
 * cut at 60 characters. Our slug for that product is
 * `remkomplekt-dlya-treshchotok-cjhm1228-toptul-clbc121201`. The article is
 * enough to find the card, so such an address answers 301 instead of 404.
 *
 * Pure: candidate articles from the slug, and the pick among products whose
 * article matches. Tested.
 */
import { generateSlug } from '../common/utils/generate-slug';

/**
 * The slug's first 1–4 hyphen tokens, longest first, as article candidates.
 * A candidate must hold a digit and be at least 4 characters: «sm» or «nabor»
 * is not an article, and short patterns would match half the catalogue.
 */
export function articleCandidates(slug: string): string[] {
  const tokens = slug.toLowerCase().split('-').filter(Boolean);
  const out: string[] = [];
  for (let k = Math.min(4, tokens.length - 1); k >= 1; k--) {
    const candidate = tokens.slice(0, k).join('-');
    if (candidate.length >= 4 && /\d/.test(candidate)) out.push(candidate);
  }
  return out;
}

/** An article as it would read in a slug: `SMP-63731/1` → `smp-63731-1`. */
export function articleSlug(sku: string): string {
  return generateSlug(sku);
}

/** Folds the two transliterations together: kh→h, ts→c, y→i. */
function fold(token: string): string {
  return token.replace(/kh/g, 'h').replace(/ts/g, 'c').replace(/y/g, 'i');
}

/** Function words that prove nothing about which product is meant. */
const STOP_WORDS = new Set(['dlia', 'bez', 'pod', 'nad', 'ili', 'pri', 'sht']);

function words(slug: string): Set<string> {
  return new Set(
    slug
      .split('-')
      .filter((t) => t.length >= 3 && !/^\d+$/.test(t))
      .map(fold)
      .filter((t) => !STOP_WORDS.has(t)),
  );
}

/**
 * Among products whose article matches a candidate, the one this address
 * meant: the longest matching article wins, then the most shared name words.
 * Several products with the same article and no word to tell them apart →
 * no redirect (a wrong 301 is worse than a 404).
 */
export function pickLegacyProduct<
  T extends { slug: string; sku: string | null; name: string },
>(slug: string, products: T[]): T | null {
  const candidates = articleCandidates(slug);
  for (const candidate of candidates) {
    const matching = products.filter(
      (p) => p.sku && articleSlug(p.sku) === candidate,
    );
    if (!matching.length) continue;
    if (matching.length === 1) return matching[0];
    const rest = words(slug.slice(candidate.length));
    const scored = matching
      .map((p) => {
        const own = words(generateSlug(p.name));
        let shared = 0;
        for (const w of rest) if (own.has(w)) shared++;
        return { p, shared };
      })
      .sort((a, b) => b.shared - a.shared);
    if (scored[0].shared > 0 && scored[0].shared > (scored[1]?.shared ?? 0)) {
      return scored[0].p;
    }
    return null;
  }
  return null;
}

/** ILIKE patterns for the candidates: a hyphen stands for any one character. */
export function articlePatterns(slug: string): string[] {
  return articleCandidates(slug).map((c) => c.replace(/-/g, '_'));
}

/**
 * Second chance when the exact article is not ours: the item code inside it.
 * STARFIX articles read «pack-code-quantity» (`SMP-63731-1` is the 63731 screw
 * in a bag; we carry `SMZ1-63731-2`, `SMC2-63731-50`, `SM-63731-700`). Codes
 * are digit runs of 4+ among the first three tokens.
 */
export function itemCodes(slug: string): string[] {
  return [
    ...new Set(
      slug
        .toLowerCase()
        .split('-')
        .slice(0, 3)
        .filter((t) => /^\d{4,}$/.test(t)),
    ),
  ];
}

/** Name words the address and a product share (both transliterations folded). */
export function sharedNameWords(slug: string, name: string): number {
  const own = words(generateSlug(name));
  let shared = 0;
  for (const w of words(slug)) if (own.has(w)) shared++;
  return shared;
}

/**
 * Whether a product's name backs the address: at least two shared words and
 * more than half of the address's own. «Мембрана для ёмкости … PA-1003»
 * shares three words with an address for the tank PA-1003 itself, out of six
 * — a part, not the product, so no.
 */
function nameBacks(slug: string, name: string): boolean {
  const shared = sharedNameWords(slug, name);
  return shared >= 2 && shared / Math.max(1, words(slug).size) > 0.5;
}

/**
 * The words several product names begin with — «Шуруп 10х60 мм шестигр.
 * головка, цинк, DIN 571» for three packs of one screw — as a search term.
 */
export function commonNamePrefix(names: string[]): string {
  if (!names.length) return '';
  let prefix = names[0];
  for (const name of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++;
    prefix = prefix.slice(0, i);
  }
  // Whole words only, without a dangling bracket or comma.
  const full = names.every(
    (n) => n.length === prefix.length || /[\s(,]/.test(n[prefix.length] ?? ' '),
  );
  const cut = full ? prefix : prefix.slice(0, prefix.lastIndexOf(' ') + 1);
  return cut.replace(/[\s(,.;:-]+$/u, '').trim();
}

export type LegacyTarget = { slug: string } | { search: string };

/**
 * By item code: products whose article holds the code and whose names share
 * at least two words with the address. One → that card; several (packs of
 * one item) → a search for what their names have in common.
 */
export function pickByItemCode<
  T extends { slug: string; sku: string | null; name: string },
>(slug: string, products: T[]): LegacyTarget | null {
  const codes = itemCodes(slug);
  const matching = products.filter(
    (p) =>
      p.sku &&
      codes.some((code) => articleSlug(p.sku!).split('-').includes(code)) &&
      nameBacks(slug, p.name),
  );
  if (!matching.length) return null;
  if (matching.length === 1) return { slug: matching[0].slug };
  const best = Math.max(...matching.map((p) => sharedNameWords(slug, p.name)));
  const top = matching.filter((p) => sharedNameWords(slug, p.name) === best);
  if (top.length === 1) return { slug: top[0].slug };
  const search = commonNamePrefix(top.map((p) => p.name));
  return search.split(/\s+/).length >= 2 ? { search } : null;
}
