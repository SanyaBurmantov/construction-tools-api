import type {
  BulkRetryResponse,
  ParserSourceOverview,
  QueueRow,
  QueueRowsResponse,
  QueueStats,
} from '~/types/parsing'

/**
 * One supplier queue on `/admin/parsing`.
 *
 * Every queue is identical in shape — same model, same six endpoints under a
 * per-source prefix — so one factory drives all of them and a change lands on
 * every source instead of all-but-one. It owns the state of a queue (rows,
 * stats, paging, filters) and the requests that move it; the panel component is
 * given the result and only renders it.
 *
 * The source is whatever `/parser/overview` listed, prefix included, so a new
 * supplier gets its queue here the moment it is in `PARSER_SOURCES`.
 */
export function createParserQueue(
  source: Pick<ParserSourceOverview, 'code' | 'host' | 'queuePrefix'>
) {
  // Every message names the supplier by host: that is what the tab says too.
  const { code: key, host, queuePrefix: prefix } = source
  const { adminFetch, errorMessage } = useAdminApi()
  const toast = useAppToast()

  const stats = ref<QueueStats | null>(null)
  const rows = ref<QueueRow[]>([])
  const pagination = reactive({ page: 1, limit: 25, total: 0, pages: 0 })
  const filters = reactive({ search: '', status: 'PROBLEM' })
  const loading = ref(false)
  const busy = ref('')

  async function load() {
    loading.value = true
    try {
      const [nextStats, nextRows] = await Promise.all([
        adminFetch<QueueStats>(`/queue${prefix}`),
        adminFetch<QueueRowsResponse>(`/queue${prefix}/sitemaps`, {
          params: compactParams({ ...filters, page: pagination.page, limit: pagination.limit }),
        }),
      ])
      stats.value = nextStats
      rows.value = nextRows.data
      Object.assign(pagination, nextRows.pagination)
    } catch (error) {
      toast.error(errorMessage(error, `Не удалось загрузить очередь ${host}`))
    } finally {
      loading.value = false
    }
  }

  /**
   * Runs one mutation and reloads, so the numbers on screen are always the
   * DB's rather than whatever the action happened to return. The request
   * resolves to the success message it wants shown.
   */
  async function run(action: string, request: () => Promise<string>) {
    busy.value = action
    try {
      toast.success(await request())
      await load()
    } catch (error) {
      toast.error(errorMessage(error, `Не удалось выполнить действие для ${host}`))
    } finally {
      busy.value = ''
    }
  }

  return {
    key, host, stats, rows, pagination, filters, loading, busy, load,
    refresh: () => run('refresh', async () => {
      await adminFetch(`/queue${prefix}/refresh-sitemaps`, { method: 'POST' })
      // tools.by has no sitemap.xml — the same button crawls its catalog.
      return `${host}: очередь пополнена`
    }),
    process: () => run('process', async () => {
      await adminFetch(`/queue${prefix}/process`, { method: 'POST', body: { limit: 25 } })
      return `${host}: обработано до 25 URL`
    }),
    retryProblems: () => run('retry-problems', async () => {
      const result = await adminFetch<BulkRetryResponse>(
        `/queue${prefix}/sitemaps/retry-problems`, { method: 'POST' }
      )
      return `${host}: возвращено в очередь ${result?.count ?? 0} URL`
    }),
    retryOne: (id: string) => run(`retry-${id}`, async () => {
      await adminFetch(`/queue${prefix}/sitemaps/${id}/retry`, { method: 'POST' })
      return `${host}: URL возвращён в очередь`
    }),
    applyFilters: () => { pagination.page = 1; return load() },
    setPage: (page: number) => { pagination.page = page; return load() },
  }
}

export type ParserQueue = ReturnType<typeof createParserQueue>
