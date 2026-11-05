/**
 * Subcategories of one category for the breadcrumbs' hover lists, fetched on
 * first hover and kept for the session (one small request per category; the
 * API caches the counted tree). `''` asks for the catalogue's roots. Only
 * listable ones arrive (non-empty, visible), biggest first.
 */
export type CategoryChild = { name: string, slug: string, productCount: number }

const cache = new Map<string, Promise<CategoryChild[]>>()

export function useCategoryChildren() {
  const { apiBase } = useSite()

  function load(slug: string): Promise<CategoryChild[]> {
    const hit = cache.get(slug)
    if (hit) return hit
    const request = (slug
      ? $fetch<{ children?: CategoryChild[] }>(`${apiBase}/categories/${encodeURIComponent(slug)}`)
          .then(page => page.children ?? [])
      : $fetch<CategoryChild[]>(`${apiBase}/categories/tree`, { params: { depth: 1 } }))
      .then(list => list
        .filter(item => item.productCount > 0)
        .map(item => ({ name: item.name, slug: item.slug, productCount: item.productCount }))
        .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name, 'ru')))
      .catch(() => {
        cache.delete(slug) // a failed fetch is retried on the next hover
        return []
      })
    cache.set(slug, request)
    return request
  }

  return { load }
}
