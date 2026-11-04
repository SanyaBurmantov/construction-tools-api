/**
 * Storefront blocks an admin curates in `/admin/storefront` (backend
 * `storefront/`). Both answer an empty list when nothing is curated, and the
 * callers then keep their automatic choice — the first root categories in the
 * header strip, the best-rated products on the home page.
 */
export type HeaderCategoryLink = {
  id: string
  name: string
  slug: string
  /** Accent colour in the strip («выделить»). */
  highlight: boolean
}

/**
 * The strip under the header, SSR-rendered on every page. A failure is an
 * automatic strip, never a broken page. The API also sends each pick's
 * artwork and count; they are dropped here because this answer sits in the
 * `__NUXT_DATA__` of every page and only the home page draws them — it reads
 * them through `useHomeCategoryTiles()`.
 */
export function useHeaderCategories() {
  const { apiBase } = useSite()
  return useAsyncData<HeaderCategoryLink[]>(
    'storefront-header-categories',
    () => $fetch<{ data: HeaderCategoryLink[] }>(`${apiBase}/storefront/header-categories`)
      .then(answer => answer.data.map(({ id, name, slug, highlight }) => ({ id, name, slug, highlight })))
      .catch(() => []),
    { default: () => [] }
  )
}

export type CategoryTileLink = HeaderCategoryLink & {
  image: string | null
  /** Null when the API did not send one: the tile then shows no count. */
  productCount: number | null
}

/**
 * The home page's «Каталог» tiles and «Популярное:» links: the header strip
 * in its own order, with what a tile draws. Its own key so that the artwork
 * URLs stay out of every other page's payload; the endpoint is cached in the
 * API, so the second request of a home render is cheap.
 */
export function useHomeCategoryTiles() {
  const { apiBase } = useSite()
  return useAsyncData<CategoryTileLink[]>(
    'home-category-tiles',
    () => $fetch<{ data: CategoryTileLink[] }>(`${apiBase}/storefront/header-categories`)
      .then(answer => answer.data.map(({ id, name, slug, highlight, image, productCount }) =>
        ({ id, name, slug, highlight, image: image ?? null, productCount: productCount ?? null })))
      .catch(() => []),
    { default: () => [] }
  )
}
