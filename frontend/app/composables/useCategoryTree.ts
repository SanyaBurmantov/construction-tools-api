/**
 * The storefront category tree — the part of it the storefront renders.
 *
 * The header, the home page and the catalogue each declared their own copy of
 * this type and their own `useAsyncData` call — same key, same endpoint, three
 * places to update whenever the payload grows. One composable keeps them in
 * step, and the shared key still means one request per render.
 *
 * The API already prunes what must not be listed: hidden branches and
 * branches with nothing published in them. Anything that arrives here is
 * safe to render, so no consumer needs to re-check a count.
 *
 * **Roots only on the server — on purpose.** Whatever `useAsyncData` returns
 * is serialised into `__NUXT_DATA__` of *every* SSR page (the header is on all
 * of them). The full tree is ~3 000 nodes with artwork URLs, ids, sort keys
 * and levels: ~1.1 MB of a ~1.15 MB page, even on /delivery. What a page
 * actually draws on the server is the roots — header row, home grid, the
 * catalogue's root strip (a category page gets its own children from
 * `GET /categories/:slug`). The roots' children are drawn only inside the
 * catalogue menu and the mobile drawer, both closed in the HTML, so they come
 * from `useCategoryMenu()` on the client instead. Counts stay whole-subtree:
 * the API aggregates before it cuts (`?depth=`). Need another field or level
 * on the server? Add it here deliberately and watch the page weight; the
 * sitemap fetches the full tree on its own.
 */
export type CategoryNode = {
  id: string
  name: string
  slug: string
  /** Roots only. */
  image?: string | null
  /** Pinned to the home page grid by an admin. Roots only. */
  isFeatured?: boolean
  /** Published products in the whole subtree. */
  productCount: number
  /**
   * Direct children of a root — empty in `useCategoryTree()` (roots only),
   * filled in `useCategoryMenu()`; always empty one level further down.
   */
  children: CategoryNode[]
}

type ApiCategoryNode = CategoryNode & { children: ApiCategoryNode[] }

/** Keeps only the fields drawn: artwork and the featured pin on roots alone. */
function slimTree(nodes: ApiCategoryNode[]): CategoryNode[] {
  return nodes.map(root => ({
    id: root.id,
    name: root.name,
    slug: root.slug,
    image: root.image ?? null,
    isFeatured: Boolean(root.isFeatured),
    productCount: root.productCount,
    children: (root.children || []).map(child => ({
      id: child.id,
      name: child.name,
      slug: child.slug,
      productCount: child.productCount,
      children: [],
    })),
  }))
}

function fetchTree(depth: number) {
  const { apiBase } = useSite()
  return () => $fetch<ApiCategoryNode[]>(`${apiBase}/categories/tree`, { params: { depth } })
    .then(slimTree)
}

/** The roots, SSR-rendered and shared by header, home and catalogue. */
export function useCategoryTree() {
  const fetchRoots = fetchTree(1)
  // A failed tree must not fail the page: every surface that uses it is
  // navigation around content that renders without it.
  return useAsyncData<CategoryNode[]>(
    'catalog-tree',
    () => fetchRoots().catch(() => [] as CategoryNode[]),
    { default: () => [] }
  )
}

/**
 * Roots with their direct children, for the header's catalogue menu and the
 * mobile drawer. Client-only and never in the SSR payload: `load()` fetches it
 * once (later calls are no-ops, the key keeps it across navigations). The
 * header calls it when the browser goes idle after hydration and again on any
 * sign of intent, so the menu is normally complete before it is opened; until
 * then `tree` falls back to the roots. A failed fetch is left to reject, so
 * `status` becomes 'error' and the next `load()` retries it; the menu keeps
 * showing the roots meanwhile.
 */
export function useCategoryMenu() {
  const { data: roots } = useNuxtData<CategoryNode[]>('catalog-tree')
  const menu = useAsyncData<CategoryNode[]>('catalog-menu', fetchTree(2), {
    server: false,
    immediate: false,
    default: () => [],
  })

  const tree = computed<CategoryNode[]>(() =>
    menu.data.value?.length ? menu.data.value : roots.value || []
  )

  function load() {
    if (import.meta.server) return
    if (menu.status.value === 'idle' || menu.status.value === 'error') {
      void menu.execute()
    }
  }

  return { tree, load }
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
