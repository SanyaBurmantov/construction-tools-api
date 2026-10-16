import type { Paginated, Pagination } from '~/types/api'

/**
 * The paged list every admin screen had its own copy of: rows, pagination,
 * loading/error, a debounced filter watch and a page switch.
 *
 * The copies had drifted into the same three bugs — a filter change on page
 * > 1 loaded twice (the filter watcher reset `page`, and `watch(page)` loaded
 * again), a slow older response could land after a newer one, and the debounce
 * timer outlived the page. Here the page is changed only through `setPage()`,
 * every response is checked against a request counter, and the timer is
 * cleared with the scope.
 */
export function useAdminList<T, R extends Paginated<T> = Paginated<T>>(
  path: string,
  options: {
    /** Filters as a getter; any change resets to page 1. Blank values are dropped. */
    params?: () => Record<string, unknown>
    limit?: number
    /** Debounce for filter changes, ms. */
    debounce?: number
    errorText?: string
    /** Extra fields of the envelope (`pendingCount`…). */
    onResponse?: (response: R) => void
    /** Load on mount (default) — off when the page sequences its own first load. */
    immediate?: boolean
  } = {},
) {
  const { adminFetch, errorMessage } = useAdminApi()
  const limit = options.limit ?? 20

  const rows = ref<T[]>([]) as Ref<T[]>
  const pagination = ref<Pagination>({ page: 1, limit, total: 0, pages: 0 })
  const page = ref(1)
  const loading = ref(false)
  const error = ref('')
  let sequence = 0

  async function load() {
    const ticket = ++sequence
    loading.value = true
    error.value = ''
    try {
      const response = await adminFetch<R>(path, {
        params: compactParams({ ...options.params?.(), page: page.value, limit }),
      })
      if (ticket !== sequence) return
      rows.value = response.data
      pagination.value = response.pagination
      options.onResponse?.(response)
    } catch (caught) {
      if (ticket !== sequence) return
      error.value = errorMessage(caught, options.errorText ?? 'Не удалось загрузить список')
    } finally {
      if (ticket === sequence) loading.value = false
    }
  }

  function setPage(next: number) {
    page.value = next
    return load()
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  if (options.params) {
    watch(
      options.params,
      () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void setPage(1), options.debounce ?? 300)
      },
      { deep: true },
    )
  }
  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })

  if (options.immediate !== false) onMounted(load)

  return { rows, pagination, page, loading, error, load, setPage }
}

/** Query params without the blanks: `''`, `null` and `undefined` are dropped, strings trimmed. */
export function compactParams(params: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    const clean = typeof value === 'string' ? value.trim() : value
    if (clean === '' || clean === null || clean === undefined) continue
    out[key] = clean
  }
  return out
}
