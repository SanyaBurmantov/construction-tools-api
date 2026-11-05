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

function words(slug: string): Set<string> {
  return new Set(
    slug
      .split('-')
      .filter((t) => t.length >= 3 && !/^\d+$/.test(t))
      .map(fold),
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
