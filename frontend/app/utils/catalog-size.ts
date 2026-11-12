/**
 * The catalogue's size as the storefront states it — «95 000+ позиций».
 *
 * The figure used to be typed into each page by hand, and the pages drifted
 * apart: «95 000+» on the home page and /organizaciyam, «более 50 тысяч» on
 * /about, while the catalogue itself kept growing. Now every page derives it
 * from one number, the sum of the root categories' counts in
 * `GET /categories/tree` — published products in listable branches, i.e.
 * exactly what a visitor can reach through the catalogue.
 *
 * Pure and import-free so `npm test` can run it under plain Node; the noun
 * («позиций») is added by `useCatalogSize()` with the shared plural forms.
 */

/** Published products under the roots; each product sits in one leaf. */
export function catalogTotal(roots: ReadonlyArray<{ productCount?: number | null }> | null | undefined): number {
  if (!roots) return 0
  return roots.reduce((sum, root) => sum + Math.max(0, Math.trunc(root.productCount ?? 0)), 0)
}

/** Digit groups joined by a no-break space, so «95 000» never wraps. */
function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')
}

/**
 * The figure to print, rounded **down** so it never overstates: 95 812 →
 * «95 000+», exactly 95 000 → «95 000». Below a thousand the exact number.
 * `count` is the number the noun agrees with («95 000+ позиций»,
 * «21 позиция»). `null` when the size is unknown (the tree did not answer) —
 * the page then says its sentence without a number rather than «0 позиций».
 */
export function catalogFigure(total: number): { text: string, count: number } | null {
  if (!Number.isFinite(total) || total <= 0) return null
  const exact = Math.trunc(total)
  if (exact < 1000) return { text: groupDigits(exact), count: exact }
  const rounded = Math.floor(exact / 1000) * 1000
  return { text: `${groupDigits(rounded)}${rounded < exact ? '+' : ''}`, count: rounded }
}
