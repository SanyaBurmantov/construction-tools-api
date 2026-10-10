/**
 * The storefront category tree.
 *
 * The header, the home page and the catalogue each declared their own copy of
 * this type and their own `useAsyncData` call — same key, same endpoint, three
 * places to update whenever the payload grows (it just grew by three display
 * fields). One composable keeps them in step, and the shared key still means
 * one request per render.
 *
 * The API already prunes what must not be listed: hidden branches and
 * branches with nothing published in them. Anything that arrives here is
 * safe to render, so no consumer needs to re-check a count.
 */
export type CategoryNode = {
  id: string
  name: string
  slug: string
  image?: string | null
  /** Curated position, 0 = never placed. The API has already applied it. */
  sortOrder?: number
  /** Pinned to the home page grid by an admin. */
  isFeatured?: boolean
  productCount: number
  children: CategoryNode[]
}

export function useCategoryTree() {
  const config = useRuntimeConfig()
  const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

  return useAsyncData<CategoryNode[]>(
    'catalog-tree',
    // A failed tree must not fail the page: every surface that uses it is
    // navigation around content that renders without it.
    () => $fetch<CategoryNode[]>(`${apiBase}/categories/tree`).catch(() => []),
    { default: () => [] }
  )
}

/**
 * Categories for a promo grid: the ones an admin pinned, then the biggest
 * ones to fill the row. With nothing pinned this is exactly the old
 * "first N of the tree" behaviour.
 */
export function featuredCategories(tree: CategoryNode[] | null, limit: number) {
  const list = tree || []
  const pinned = list.filter(node => node.isFeatured)
  const rest = list.filter(node => !node.isFeatured)
  return [...pinned, ...rest].slice(0, limit)
}
