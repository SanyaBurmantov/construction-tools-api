/**
 * Which page numbers a pager shows — and therefore which pages a crawler can
 * reach from this one, since every number is a real `<a href>`.
 *
 * The old window «1 … p-1 p p+1 … last» linked page 1 to 2 and to the last
 * page only: page 90 of «Торцевые головки» (178 pages) was ~88 clicks deep,
 * and Search Console listed 67% of the products as «URL неизвестен Google».
 *
 * Besides that window, the pager links the pages at **p ± 4^k** (4, 16, 64,
 * 256, …). Any distance is then a short sum of those steps (a balanced base-4
 * number, each digit at most two hops), so every page is O(log N) clicks from
 * any other: from page 1, at most 6 to any of 178 pages (avg 3.6), 9 to any of
 * 3 960 (the whole catalogue). Powers of two would give 4 hops at 178 but
 * twice the numbers (16 instead of 10) — a pager that no longer fits one line
 * beside the filters; equal milestones (every N/10th page) leave the gaps
 * between milestones linear. The figures are checked in
 * server/utils/pagination.test.ts.
 *
 * `anchors: false` is the old window alone — for a pager of buttons (admin
 * tables, the account's orders, reviews): no crawler follows a button, and
 * the narrow admin panels have no room for a second row of numbers.
 */
export const PAGINATION_ANCHOR_BASE = 4

/** Up to this many pages every number is shown and nothing is skipped. */
const SHOW_ALL_UP_TO = 7

export interface PaginationItem {
  page: number
  /** Pages are skipped between the previous number and this one («…»). */
  gapBefore: boolean
}

export interface PaginationOptions {
  /** Links at p ± 4^k (default on): what makes a long listing crawlable. */
  anchors?: boolean
}

/** The sorted page numbers to link from `page` out of `pages`. */
export function paginationPages(page: number, pages: number, options: PaginationOptions = {}): number[] {
  if (!Number.isFinite(pages) || pages < 1) return []
  const total = Math.floor(pages)
  const current = Math.min(Math.max(1, Math.floor(page) || 1), total)
  if (total <= SHOW_ALL_UP_TO) return Array.from({ length: total }, (_, i) => i + 1)

  const set = new Set([1, total, current - 1, current, current + 1])
  if (options.anchors !== false) {
    for (let step = PAGINATION_ANCHOR_BASE; step < total; step *= PAGINATION_ANCHOR_BASE) {
      set.add(current - step)
      set.add(current + step)
    }
  }
  return [...set].filter(n => n >= 1 && n <= total).sort((a, b) => a - b)
}

/** The same list with «…» marks where numbers are skipped. */
export function paginationItems(page: number, pages: number, options: PaginationOptions = {}): PaginationItem[] {
  return paginationPages(page, pages, options).map((n, index, list) => ({
    page: n,
    gapBefore: index > 0 && n - list[index - 1]! > 1,
  }))
}
