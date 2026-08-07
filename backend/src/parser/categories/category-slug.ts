/**
 * Public slug candidates for a category, best first.
 *
 * The leaf name alone is the nice URL (`/catalog/perforatory`), and it is what
 * every category had before `pathKey` existed — so it stays the first choice and
 * existing URLs do not move. The fallbacks only come into play for the case that
 * used to silently merge two categories: the same leaf under different parents.
 */
export function categorySlugCandidates(pathSlugs: string[]): string[] {
  const clean = pathSlugs.filter(Boolean);
  if (!clean.length) return [];

  const leaf = clean[clean.length - 1];
  const withParent =
    clean.length > 1 ? `${clean[clean.length - 2]}-${leaf}` : '';
  const full = clean.join('-');

  // A Set keeps the order while dropping the duplicates a short chain produces
  // (for a top-level category all three candidates are the same string).
  return [...new Set([leaf, withParent, full].filter(Boolean))];
}

/** Identity of a category: its full slug chain from the root. */
export function categoryPathKey(pathSlugs: string[]): string {
  return pathSlugs.filter(Boolean).join('/');
}

/**
 * Numbered fallback for the case where every candidate is taken by an unrelated
 * branch — e.g. three different "Прочее" whose parents are also named alike.
 */
export function numberedSlug(base: string, attempt: number): string {
  return `${base}-${attempt}`;
}
