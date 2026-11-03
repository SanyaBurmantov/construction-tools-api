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
 * The strip under the header, SSR-rendered on every page. Shared key: the
 * home page's «Популярное:» links read the same answer. A failure is an
 * automatic strip, never a broken page.
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
