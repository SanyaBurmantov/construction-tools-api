// Explicit relative imports: `server/routes/llms.txt.ts` imports
// `catalogSizeText` from here, and Nitro has none of the app's auto-imports.
import { catalogFigure, catalogTotal } from '../utils/catalog-size'
import { plural, PLURALS } from './usePlural'

/**
 * «95 000+ позиций» from the roots of the category tree, or `''` when the
 * size is unknown. One wording for every page and for /llms.txt — see
 * `utils/catalog-size.ts` for why it is never typed in by hand.
 */
export function catalogSizeText(roots: ReadonlyArray<{ productCount?: number | null }> | null | undefined): string {
  const figure = catalogFigure(catalogTotal(roots))
  return figure ? `${figure.text}\u00A0${plural(figure.count, ...PLURALS.position)}` : ''
}

/**
 * The catalogue size for a page. Reuses `useCategoryTree()` — the header
 * already fetches it on every SSR page under the same key, so this costs no
 * extra request there. Await it in `<script setup>` so the number is in the
 * server HTML (and in a meta description built from it).
 */
export async function useCatalogSize() {
  const { data } = await useCategoryTree()
  return computed(() => catalogSizeText(data.value))
}
