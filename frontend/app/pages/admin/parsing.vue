<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type QueueStatus = 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED'
type QueueStats = { queued: number, visited: number, failed: number, skipped: number, total: number }

/** All three supplier queues share one model, so one row type covers them. */
type QueueRow = {
  id: string
  url: string
  status: QueueStatus
  attempts: number
  lastError?: string | null
  lastTriedAt?: string | null
}
type QueueRowsResponse = { data: QueueRow[], pagination: { page: number, limit: number, total: number, pages: number } }
type BulkRetryResponse = { count: number }

type ParserHealth = {
  ok: boolean
  maxAgeHours: number
  jobs: Array<{
    key: string
    label: string
    isRunning: boolean
    health: 'OK' | 'RUNNING' | 'ERROR' | 'STALE'
    startedAt: string | null
    finishedAt: string | null
    lastSuccessAt: string | null
    lastErrorAt: string | null
    lastError: string | null
    runs: number
    successes: number
    failures: number
  }>
}
type ParserRun = {
  id: string
  key: string
  label: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  error: string | null
  errorCount: number
}

type ParserError = { url: string, message: string, createdAt: string }
type Source = { id: string, name: string, code: string, url: string }
type SupplierSummary = {
  source: { id: string, name: string, code: string }
  total: number, published: number, draft: number, hidden: number, archived: number
  withoutPrice: number, withoutImages: number, withoutSku: number
}

type ProductRef = { id: string, name: string, slug: string }
type DuplicateGroup = { key: string, products: Array<ProductRef & { sources: string[] }> }
type DataQualityReport = {
  generatedAt: string
  summary: {
    publishedProducts: number, totalProducts: number, withoutImages: number, withoutPrice: number,
    withoutSpecs: number, withoutBrand: number, inFallbackCategory: number, staleProducts: number,
    staleDays: number, duplicateGroups: number, allCapsNames: number
  }
  samples: {
    withoutImages: ProductRef[], withoutPrice: ProductRef[], withoutSpecs: ProductRef[],
    inFallbackCategory: ProductRef[], stale: ProductRef[], allCapsNames: ProductRef[],
    duplicates: DuplicateGroup[]
  }
}

const { token, loadToken, adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()

const dateTimeFormatter = new Intl.DateTimeFormat('ru-BY', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})
const formatDateTime = (iso: string | null | undefined) =>
  iso ? dateTimeFormatter.format(new Date(iso)) : '—'

/** "5 мин назад" reads faster than a timestamp when you're checking liveness. */
function formatAgo(iso: string | null | undefined) {
  if (!iso) return 'ещё не было'
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'только что'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return `${Math.round(hours / 24)} дн назад`
}

function formatDuration(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} мс`
  if (ms < 60_000) return `${Math.round(ms / 1000)} с`
  return `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с`
}

/* ----------------------------------------------------------------- control */

type CategoryStats = {
  queued: number, visited: number, failed: number, skipped: number, disabled: number
  total: number, productsFound: number, productsQueued: number
}
type ParserSourceOverview = {
  code: string
  name: string
  hasCategoryQueue: boolean
  cronEnabled: boolean
  /** Global switch AND the source switch — what the cron actually checks. */
  effectiveEnabled: boolean
  batchLimit: number
  requestDelayMs: number
  maxPages: number
  categoryFilters: { include: string, exclude: string }
  envFlag: string
  envFlagValue: string | null
  products: QueueStats
  categories: CategoryStats | null
  jobs: ParserHealth['jobs']
}
type ParserOverview = {
  cronEnabled: boolean
  envCronEnabled: string | null
  globalOverriddenInDb: boolean
  isRunning: boolean
  health: { ok: boolean, maxAgeHours: number }
  sources: ParserSourceOverview[]
}

type SourceDraft = {
  batchLimit: number
  requestDelayMs: number
  maxPages: number
  categoryIncludeRegex: string
  categoryExcludeRegex: string
}

type ParserJob = {
  name: string
  key: string
  label: string
  description: string
  isRunning: boolean
  health: 'OK' | 'RUNNING' | 'ERROR' | 'STALE' | null
  lastSuccessAt: string | null
  lastError: string | null
}

const control = ref<ParserOverview | null>(null)
const jobs = ref<ParserJob[]>([])
const jobsBusy = ref('')
/** Polls while something is running, so a long crawl shows progress. */
let jobsTimer: ReturnType<typeof setInterval> | null = null

async function loadJobs() {
  if (!token.value || !expandedSource.value) return
  try {
    jobs.value = await adminFetch<ParserJob[]>(`/parser/sources/${expandedSource.value}/jobs`)
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось загрузить задания'))
  }
}

/**
 * Fires the job and returns at once — a tools.by catalog crawl runs for about
 * a quarter of an hour, so the button reports "запущено", not "готово".
 */
async function runJob(job: ParserJob) {
  jobsBusy.value = job.name
  try {
    const result = await adminFetch<{ started: boolean, reason?: string }>(
      `/parser/sources/${expandedSource.value}/jobs/${job.name}/run`,
      { method: 'POST' },
    )
    if (result.started) {
      toast.success(`${job.label}: запущено, следите за статусом`)
    } else {
      toast.error(`${job.label}: уже выполняется`)
    }
    await loadJobs()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось запустить задание'))
  } finally {
    jobsBusy.value = ''
  }
}

const anyJobRunning = computed(() => jobs.value.some(job => job.isRunning))

watch(anyJobRunning, (running) => {
  if (running && !jobsTimer) {
    jobsTimer = setInterval(() => {
      void loadJobs()
      void loadControl()
    }, 5000)
  } else if (!running && jobsTimer) {
    clearInterval(jobsTimer)
    jobsTimer = null
  }
})

onBeforeUnmount(() => {
  if (jobsTimer) clearInterval(jobsTimer)
})

const controlBusy = ref('')
/** Edited separately from `control` so typing doesn't fight a reload. */
const drafts = reactive<Record<string, SourceDraft>>({})
/** Which source has its advanced settings open. */
const expandedSource = ref('')

function draftFor(source: ParserSourceOverview): SourceDraft {
  return (drafts[source.code] ??= {
    batchLimit: source.batchLimit,
    requestDelayMs: source.requestDelayMs,
    maxPages: source.maxPages,
    categoryIncludeRegex: source.categoryFilters.include,
    categoryExcludeRegex: source.categoryFilters.exclude,
  })
}

/** True when the form differs from what the server currently has. */
function isDirty(source: ParserSourceOverview) {
  const draft = drafts[source.code]
  if (!draft) return false
  return (
    draft.batchLimit !== source.batchLimit
    || draft.requestDelayMs !== source.requestDelayMs
    || draft.maxPages !== source.maxPages
    || draft.categoryIncludeRegex !== source.categoryFilters.include
    || draft.categoryExcludeRegex !== source.categoryFilters.exclude
  )
}

async function loadControl() {
  if (!token.value) return
  try {
    control.value = await adminFetch<ParserOverview>('/parser/overview')
    // Re-seed drafts from the server so a saved value stops looking edited.
    for (const source of control.value.sources) {
      drafts[source.code] = {
        batchLimit: source.batchLimit,
        requestDelayMs: source.requestDelayMs,
        maxPages: source.maxPages,
        categoryIncludeRegex: source.categoryFilters.include,
        categoryExcludeRegex: source.categoryFilters.exclude,
      }
    }
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось загрузить настройки парсинга'))
  }
}

async function runControl(action: string, request: () => Promise<string>) {
  controlBusy.value = action
  try {
    toast.success(await request())
    await loadControl()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось изменить настройки'))
  } finally {
    controlBusy.value = ''
  }
}

const toggleCron = (enabled: boolean) =>
  runControl('cron', async () => {
    await adminFetch('/parser/cron', { method: 'PATCH', body: { enabled } })
    return enabled ? 'Парсинг включён' : 'Парсинг остановлен'
  })

const toggleSource = (code: string, enabled: boolean) =>
  runControl(`source-${code}`, async () => {
    await adminFetch(`/parser/sources/${code}`, {
      method: 'PATCH',
      body: { cronEnabled: enabled },
    })
    return `${code}: ${enabled ? 'включён' : 'выключен'}`
  })

/**
 * Saves every field of the source form in one request. The backend validates
 * the regexes and answers 400 with the reason, so a broken filter never reaches
 * the parser — it would otherwise throw on every single product.
 */
const saveSourceSettings = (code: string) =>
  runControl(`settings-${code}`, async () => {
    const draft = drafts[code]!
    await adminFetch(`/parser/sources/${code}`, {
      method: 'PATCH',
      body: {
        batchLimit: Number(draft.batchLimit),
        requestDelayMs: Number(draft.requestDelayMs),
        maxPages: Number(draft.maxPages),
        categoryIncludeRegex: draft.categoryIncludeRegex,
        categoryExcludeRegex: draft.categoryExcludeRegex,
      },
    })
    return `${code}: настройки сохранены`
  })

/** Один прогон каждые 30 минут — отсюда и скорость разбора очереди. */
const RUNS_PER_DAY = 48

/**
 * The number the admin actually needs: at the current batch size, how long the
 * remaining queue takes. 30 URL раз в полчаса на 39 000 товаров — это 27 дней,
 * и на глаз это неотличимо от остановки.
 */
function queueEta(source: ParserSourceOverview) {
  const perDay = source.batchLimit * RUNS_PER_DAY
  if (!source.effectiveEnabled) return 'парсинг выключен'
  if (!source.products.queued) return 'очередь пуста'
  const days = source.products.queued / perDay
  if (days < 1) return `~${Math.max(Math.round(days * 24), 1)} ч`
  return `~${Math.round(days)} дн (${perDay} URL/сутки)`
}

const expandedSourceRow = computed(() =>
  control.value?.sources.find(source => source.code === expandedSource.value) ?? null
)

const controlBanner = computed(() => {
  const overview = control.value
  if (!overview) return { tone: 'info' as const, title: 'Загружаем состояние парсинга…', text: '' }

  if (!overview.cronEnabled) {
    return {
      tone: 'danger' as const,
      title: 'Парсинг остановлен',
      text: 'Крон выключен — очередь не разбирается. Включите переключатель ниже.',
    }
  }

  const idle = overview.sources.filter(source => !source.effectiveEnabled)
  if (idle.length === overview.sources.length) {
    return {
      tone: 'danger' as const,
      title: 'Парсинг остановлен',
      text: 'Крон включён, но все источники выключены по отдельности.',
    }
  }

  if (overview.isRunning) {
    return { tone: 'info' as const, title: 'Идёт разбор очереди', text: 'Прямо сейчас работает как минимум один парсер.' }
  }

  if (!overview.health.ok) {
    return {
      tone: 'warning' as const,
      title: 'Парсинг включён, но есть проблемы',
      text: `Успешного запуска не было дольше ${overview.health.maxAgeHours} ч — смотрите карточки кронов ниже.`,
    }
  }

  return {
    tone: 'success' as const,
    title: 'Парсинг работает',
    text: 'Очередь разбирается каждые 30 минут.',
  }
})

/* ------------------------------------------------------------------ queues */

/**
 * The three supplier queues are identical in shape — same model, same six
 * endpoints under a per-source prefix. One factory drives all of them so a
 * change lands on every source instead of two out of three.
 */
function createQueue(key: string, label: string, host: string, prefix: string) {
  const stats = ref<QueueStats | null>(null)
  const rows = ref<QueueRow[]>([])
  const pagination = reactive({ page: 1, limit: 25, total: 0, pages: 0 })
  const filters = reactive({ search: '', status: 'PROBLEM' })
  const loading = ref(false)
  const busy = ref('')

  function query() {
    const params = new URLSearchParams()
    if (filters.search) params.set('search', filters.search)
    if (filters.status) params.set('status', filters.status)
    params.set('page', String(pagination.page))
    params.set('limit', String(pagination.limit))
    return `?${params}`
  }

  async function load() {
    loading.value = true
    try {
      const [nextStats, nextRows] = await Promise.all([
        adminFetch<QueueStats>(`/queue${prefix}`),
        adminFetch<QueueRowsResponse>(`/queue${prefix}/sitemaps${query()}`),
      ])
      stats.value = nextStats
      rows.value = nextRows.data
      Object.assign(pagination, nextRows.pagination)
    } catch (error) {
      toast.error(errorMessage(error, `Не удалось загрузить очередь ${label}`))
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
      toast.error(errorMessage(error, `Не удалось выполнить действие для ${label}`))
    } finally {
      busy.value = ''
    }
  }

  return {
    key, label, host, stats, rows, pagination, filters, loading, busy, load,
    refresh: () => run('refresh', async () => {
      await adminFetch(`/queue${prefix}/refresh-sitemaps`, { method: 'POST' })
      // tools.by has no sitemap.xml — the same button crawls its catalog.
      return `${label}: очередь пополнена`
    }),
    process: () => run('process', async () => {
      await adminFetch(`/queue${prefix}/process`, { method: 'POST', body: { limit: 25 } })
      return `${label}: обработано до 25 URL`
    }),
    retryProblems: () => run('retry-problems', async () => {
      const result = await adminFetch<BulkRetryResponse>(
        `/queue${prefix}/sitemaps/retry-problems`, { method: 'POST' }
      )
      return `${label}: возвращено в очередь ${result?.count ?? 0} URL`
    }),
    retryOne: (id: string) => run(`retry-${id}`, async () => {
      await adminFetch(`/queue${prefix}/sitemaps/${id}/retry`, { method: 'POST' })
      return `${label}: URL возвращён в очередь`
    }),
    applyFilters: () => { pagination.page = 1; return load() },
    setPage: (page: number) => { pagination.page = page; return load() },
  }
}

const queues = [
  createQueue('th-tools', 'th.by', 'th.by', ''),
  createQueue('tools-by', 'Tools.by', 'tools.by', '/tools-by'),
  createQueue('dukon', 'Dukon', 'dukon.by', '/dukon'),
  createQueue('7745', '7745', '7745.by', '/7745'),
]
const activeQueue = ref(queues[0]!.key)

/**
 * Only the selected queue is rendered. Keeping all three mounted behind
 * `v-show` meant three tables in the DOM for one visible panel, and the `:key`
 * makes Vue rebuild the panel on switch instead of patching stale rows into it.
 */
const queue = computed(() => queues.find(item => item.key === activeQueue.value) ?? queues[0]!)

const queueTabs = computed(() =>
  queues.map(item => ({
    value: item.key,
    label: item.host,
    count: item.stats.value?.queued ?? null,
  }))
)

/** Totals across every source — the old page showed one source's numbers as if global. */
const totals = computed(() =>
  queues.reduce<QueueStats>((acc, item) => {
    const stats = item.stats.value
    if (!stats) return acc
    return {
      queued: acc.queued + stats.queued,
      visited: acc.visited + stats.visited,
      failed: acc.failed + stats.failed,
      skipped: acc.skipped + stats.skipped,
      total: acc.total + stats.total,
    }
  }, { queued: 0, visited: 0, failed: 0, skipped: 0, total: 0 })
)

const STATUS_OPTIONS = [
  { value: 'PROBLEM', label: 'Проблемные' },
  { value: '', label: 'Все статусы' },
  { value: 'PENDING', label: 'В очереди' },
  { value: 'DONE', label: 'Готово' },
  { value: 'FAILED', label: 'Ошибка' },
  { value: 'SKIPPED', label: 'Пропущено' },
]

const STATUS_TONE: Record<QueueStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  DONE: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
  SKIPPED: 'neutral',
}

const QUEUE_COLUMNS = [
  { key: 'url', label: 'URL' },
  { key: 'status', label: 'Статус', width: '120px', nowrap: true },
  { key: 'attempts', label: 'Попыток', width: '90px', align: 'end' as const },
  { key: 'lastTriedAt', label: 'Последняя попытка', width: '160px', nowrap: true },
  { key: 'actions', label: '', width: '110px', align: 'end' as const },
]

/* ---------------------------------------------------------- category queue */

type CategoryRow = {
  id: string
  url: string
  name: string
  path: string[]
  level: number
  isEnabled: boolean
  status: QueueStatus
  attempts: number
  pagesCrawled: number
  productsFound: number
  productsQueued: number
  lastError: string | null
  visitedAt: string | null
}

/** Sources with a category crawler; the rest only have a products queue. */
const categorySources = computed(() =>
  (control.value?.sources ?? []).filter(source => source.hasCategoryQueue)
)
const categorySource = ref('th-tools')
const categoryRows = ref<CategoryRow[]>([])
const categoryPagination = reactive({ page: 1, limit: 50, total: 0, pages: 0 })
const categoryFilters = reactive({ search: '', status: '' })
const categoryLoading = ref(false)
const categoryBusy = ref('')

const categoryStats = computed(() =>
  categorySources.value.find(source => source.code === categorySource.value)?.categories ?? null
)

const CATEGORY_STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'PENDING', label: 'В очереди' },
  { value: 'DONE', label: 'Обойдена' },
  { value: 'PROBLEM', label: 'Проблемные' },
  { value: 'DISABLED', label: 'Выключенные' },
]

const CATEGORY_COLUMNS = [
  { key: 'name', label: 'Категория' },
  { key: 'status', label: 'Статус', width: '120px', nowrap: true },
  { key: 'productsFound', label: 'Товаров', width: '110px', align: 'end' as const },
  { key: 'visitedAt', label: 'Обойдена', width: '150px', nowrap: true },
  { key: 'actions', label: '', width: '190px', align: 'end' as const },
]

async function loadCategories() {
  if (!token.value) return
  categoryLoading.value = true
  try {
    const params = new URLSearchParams({ source: categorySource.value })
    if (categoryFilters.search) params.set('search', categoryFilters.search)
    if (categoryFilters.status) params.set('status', categoryFilters.status)
    params.set('page', String(categoryPagination.page))
    params.set('limit', String(categoryPagination.limit))

    const response = await adminFetch<{ data: CategoryRow[], pagination: typeof categoryPagination }>(
      `/parser/categories?${params}`
    )
    categoryRows.value = response.data
    Object.assign(categoryPagination, response.pagination)
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось загрузить очередь категорий'))
  } finally {
    categoryLoading.value = false
  }
}

async function runCategoryAction(action: string, request: () => Promise<string>) {
  categoryBusy.value = action
  try {
    toast.success(await request())
    await Promise.all([loadCategories(), loadControl()])
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось выполнить действие'))
  } finally {
    categoryBusy.value = ''
  }
}

const refreshCategories = () =>
  runCategoryAction('refresh', async () => {
    const result = await adminFetch<{ seen: number, added: number }>(
      `/parser/sources/${categorySource.value}/categories/refresh`, { method: 'POST' }
    )
    return `Категорий у поставщика: ${result.seen}, новых в очереди: ${result.added}`
  })

const processCategories = () =>
  runCategoryAction('process', async () => {
    const result = await adminFetch<{ categoriesProcessed: number, productsQueuedNow: number }>(
      `/parser/sources/${categorySource.value}/categories/process`,
      { method: 'POST', body: { limit: 3 } }
    )
    return `Обойдено категорий: ${result.categoriesProcessed}, новых товаров в очереди: ${result.productsQueuedNow}`
  })

const retryProblemCategories = () =>
  runCategoryAction('retry-problems', async () => {
    const result = await adminFetch<BulkRetryResponse>(
      `/parser/sources/${categorySource.value}/categories/retry-problems`, { method: 'POST' }
    )
    return `Возвращено в очередь: ${result?.count ?? 0}`
  })

const resetCategories = () =>
  runCategoryAction('reset', async () => {
    const result = await adminFetch<BulkRetryResponse>(
      `/parser/sources/${categorySource.value}/categories/reset`, { method: 'POST' }
    )
    return `Переобход назначен для ${result?.count ?? 0} категорий`
  })

const retryCategory = (id: string) =>
  runCategoryAction(`retry-${id}`, async () => {
    await adminFetch(`/parser/categories/${id}/retry`, { method: 'POST' })
    return 'Категория возвращена в очередь'
  })

/**
 * Switching a branch off also switches off its `SourceCategory` subtree, so
 * products from it stop being imported — not just crawled.
 */
const toggleCategory = (row: CategoryRow) =>
  runCategoryAction(`toggle-${row.id}`, async () => {
    await adminFetch(`/parser/categories/${row.id}`, {
      method: 'PATCH',
      body: { isEnabled: !row.isEnabled },
    })
    return `${row.name}: ${row.isEnabled ? 'не парсим' : 'парсим'}`
  })

function setCategoryPage(page: number) {
  categoryPagination.page = page
  return loadCategories()
}

function applyCategoryFilters() {
  categoryPagination.page = 1
  return loadCategories()
}

watch(expandedSource, () => {
  jobs.value = []
  void loadJobs()
})

watch(categorySource, () => {
  categoryPagination.page = 1
  void loadCategories()
})

/* ------------------------------------------------------------------ health */

const health = ref<ParserHealth | null>(null)
const runs = ref<ParserRun[]>([])
const errors = ref<ParserError[]>([])
const supplierSummary = ref<SupplierSummary[]>([])
const sources = ref<Source[]>([])
const overviewLoading = ref(false)

const HEALTH_TONE: Record<string, 'success' | 'info' | 'danger' | 'warning'> = {
  OK: 'success',
  RUNNING: 'info',
  ERROR: 'danger',
  STALE: 'warning',
}
const HEALTH_LABEL: Record<string, string> = {
  OK: 'В норме',
  RUNNING: 'Работает',
  ERROR: 'Ошибка',
  STALE: 'Молчит',
}

/**
 * The error log is capped at 200 rows server-side, so a bare `.length` silently
 * pins at 200 and stops meaning anything. Say "200+" when we're at the cap.
 */
const ERROR_LOG_CAP = 200
const errorCountLabel = computed(() =>
  errors.value.length >= ERROR_LOG_CAP ? `${ERROR_LOG_CAP}+` : String(errors.value.length)
)

async function loadOverview() {
  if (!token.value) return
  overviewLoading.value = true
  try {
    const [nextHealth, nextRuns, nextErrors, nextSummary, nextSources] = await Promise.all([
      adminFetch<ParserHealth>('/queue/health'),
      adminFetch<ParserRun[]>('/queue/runs?limit=20'),
      adminFetch<ParserError[]>('/queue/errors'),
      adminFetch<SupplierSummary[]>('/queue/supplier-summary'),
      adminFetch<Source[]>('/sources'),
    ])
    health.value = nextHealth
    runs.value = nextRuns
    errors.value = nextErrors
    supplierSummary.value = nextSummary
    sources.value = nextSources
    // The header's "Обновить состояние" is the one button an operator presses,
    // so it has to refresh the switches too, not just the health cards.
    await loadControl()
    if (!importForm.sourceId && nextSources.length === 1) importForm.sourceId = nextSources[0]!.id
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось загрузить состояние парсеров'))
  } finally {
    overviewLoading.value = false
  }
}

async function clearErrors() {
  try {
    await adminFetch('/queue/errors', { method: 'DELETE' })
    toast.success('Лог ошибок очищен')
    await loadOverview()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось очистить лог'))
  }
}

/* ---------------------------------------------------------------- import */

const importForm = reactive({ sourceId: null as string | null, url: '' })
const importing = ref(false)

async function importProduct() {
  if (!importForm.sourceId || !importForm.url) return
  importing.value = true
  try {
    const result = await adminFetch<{ product: { name: string } }>('/source-products/import', {
      method: 'POST',
      body: { ...importForm },
    })
    toast.success(`Товар добавлен: ${result.product.name}`)
    importForm.url = ''
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось добавить товар из источника'))
  } finally {
    importing.value = false
  }
}

/* --------------------------------------------------------- data quality */

const dataQuality = ref<DataQualityReport | null>(null)
const dataQualityLoading = ref(false)

// Отчёт тяжёлый (скан имён всего каталога) — грузим отдельно от остального.
async function loadDataQuality() {
  if (!token.value) return
  dataQualityLoading.value = true
  try {
    dataQuality.value = await adminFetch<DataQualityReport>('/data-quality')
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось загрузить отчёт качества'))
  } finally {
    dataQualityLoading.value = false
  }
}

const qualityMetrics = computed(() => {
  const report = dataQuality.value
  if (!report) return []
  return [
    { key: 'withoutImages', label: 'Без фото', count: report.summary.withoutImages, items: report.samples.withoutImages },
    { key: 'withoutPrice', label: 'Без цены', count: report.summary.withoutPrice, items: report.samples.withoutPrice },
    { key: 'withoutSpecs', label: 'Без характеристик', count: report.summary.withoutSpecs, items: report.samples.withoutSpecs },
    { key: 'inFallbackCategory', label: 'Неразобранная категория', count: report.summary.inFallbackCategory, items: report.samples.inFallbackCategory },
    { key: 'stale', label: `Не обновлялись > ${report.summary.staleDays} дн.`, count: report.summary.staleProducts, items: report.samples.stale },
    { key: 'allCaps', label: 'Название КАПСОМ', count: report.summary.allCapsNames, items: report.samples.allCapsNames },
  ]
})

onMounted(async () => {
  loadToken()
  // Control first: the category queue needs to know which sources have a
  // crawler before it can load anything.
  await loadControl()
  void loadCategories()
  void loadOverview()
  void Promise.all(queues.map(item => item.load()))
  void loadDataQuality()
})

useHead({ title: 'Парсинг | Админка', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>

<template>
  <div class="admin-parsing">
    <header class="head">
      <div>
        <h1>Парсинг</h1>
        <p>Состояние кронов, очереди поставщиков и качество импортированных данных.</p>
      </div>
      <div class="head-actions">
        <UiButton variant="secondary" size="sm" :loading="overviewLoading" @click="loadOverview()">
          Обновить состояние
        </UiButton>
      </div>
    </header>

    <!-- --------------------------------------------------------- control -->
    <UiCard :padded="false">
      <template #header>
        <div class="card-head">
          <h2>Управление парсингом</h2>
          <p>
            Переключатели действуют сразу, без передеплоя: значение хранится в БД
            и перекрывает переменные окружения.
          </p>
        </div>
      </template>
      <template #actions>
        <UiButton
          :variant="control?.cronEnabled ? 'secondary' : 'primary'"
          size="sm"
          :loading="controlBusy === 'cron'"
          @click="toggleCron(!control?.cronEnabled)"
        >
          {{ control?.cronEnabled ? 'Остановить парсинг' : 'Запустить парсинг' }}
        </UiButton>
      </template>

      <div class="pad">
        <UiAlert :tone="controlBanner.tone" :title="controlBanner.title">
          {{ controlBanner.text }}
        </UiAlert>
      </div>

      <UiTable
        :columns="[
          { key: 'name', label: 'Источник' },
          { key: 'state', label: 'Крон', width: '150px', nowrap: true },
          { key: 'queue', label: 'Очередь товаров', width: '190px' },
          { key: 'batch', label: 'Пачка за запуск', width: '210px' },
          { key: 'eta', label: 'Разбор очереди', width: '180px', nowrap: true }
        ]"
        :rows="control?.sources ?? []"
        row-key="code"
        empty-text="Источники не настроены."
      >
        <template #cell-name="{ row }">
          <strong>{{ row.name }}</strong>
          <span class="code">{{ row.code }}</span>
        </template>

        <template #cell-state="{ row }">
          <UiButton
            size="sm"
            :variant="row.cronEnabled ? 'secondary' : 'ghost'"
            :loading="controlBusy === `source-${row.code}`"
            @click="toggleSource(row.code, !row.cronEnabled)"
          >
            {{ row.cronEnabled ? 'Включён' : 'Выключен' }}
          </UiButton>
          <p v-if="row.cronEnabled && !row.effectiveEnabled" class="muted hint">
            не работает: общий крон выключен
          </p>
        </template>

        <template #cell-queue="{ row }">
          <span>{{ row.products.queued }} в очереди</span>
          <p class="muted hint">
            обработано {{ row.products.visited }}, ошибок {{ row.products.failed }}
          </p>
        </template>

        <template #cell-batch="{ row }">
          <div class="batch-form">
            <UiInput v-model.number="draftFor(row).batchLimit" type="number" size="sm" min="1" max="2000" />
            <UiButton
              size="sm"
              variant="ghost"
              @click="expandedSource = expandedSource === row.code ? '' : row.code"
            >
              {{ expandedSource === row.code ? 'Свернуть' : 'Ещё…' }}
            </UiButton>
          </div>
        </template>

        <template #cell-eta="{ row }">
          <span class="muted">{{ queueEta(row) }}</span>
          <UiButton
            v-if="isDirty(row)"
            size="sm"
            :loading="controlBusy === `settings-${row.code}`"
            class="save-btn"
            @click="saveSourceSettings(row.code)"
          >
            Сохранить
          </UiButton>
        </template>
      </UiTable>

      <!-- Расширенные настройки выбранного источника -->
      <div v-if="expandedSourceRow" class="pad advanced">
        <h3>{{ expandedSourceRow.name }} — настройки парсера</h3>

        <div class="advanced-grid">
          <label>
            <span>Пауза между запросами, мс</span>
            <UiInput
              v-model.number="draftFor(expandedSourceRow).requestDelayMs"
              type="number"
              size="sm"
              min="200"
              max="60000"
            />
            <small>Вежливость к поставщику. Меньше 1000 мс — только по согласованию с ним.</small>
          </label>

          <label>
            <span>Страниц за обход каталога</span>
            <UiInput
              v-model.number="draftFor(expandedSourceRow).maxPages"
              type="number"
              size="sm"
              min="1"
              max="100000"
            />
            <small>Если счётчик обхода упирается ровно в это число — каталог обошёлся не весь.</small>
          </label>
        </div>

        <label class="advanced-full">
          <span>INCLUDE — брать только эти категории</span>
          <UiInput v-model="draftFor(expandedSourceRow).categoryIncludeRegex" size="sm" placeholder="пусто = брать всё" />
          <small>Регулярное выражение по цепочке хлебных крошек, без учёта регистра.</small>
        </label>

        <label class="advanced-full">
          <span>EXCLUDE — не брать эти категории</span>
          <UiInput v-model="draftFor(expandedSourceRow).categoryExcludeRegex" size="sm" />
          <small>
            Применяется ко всей цепочке, поэтому правило ловит и подкатегории.
            Ошибка в выражении не сохранится — сервер её отклонит.
          </small>
        </label>

        <section class="jobs">
          <h4>Запустить вручную</h4>
          <p class="muted hint">
            Задание стартует в фоне: кнопка сообщает «запущено», а не «готово».
            Пока что-то выполняется, статус обновляется сам каждые 5 секунд.
          </p>

          <div v-for="job in jobs" :key="job.name" class="job">
            <div class="job-info">
              <strong>{{ job.label }}</strong>
              <p class="muted hint">{{ job.description }}</p>
              <p v-if="job.lastError" class="row-error" :title="job.lastError">
                {{ job.lastError }}
              </p>
            </div>

            <div class="job-state">
              <UiBadge v-if="job.isRunning" tone="info" size="sm">Выполняется</UiBadge>
              <UiBadge
                v-else-if="job.health"
                :tone="HEALTH_TONE[job.health] || 'neutral'"
                size="sm"
              >
                {{ HEALTH_LABEL[job.health] || job.health }}
              </UiBadge>
              <span class="muted hint">{{ formatAgo(job.lastSuccessAt) }}</span>
            </div>

            <UiButton
              size="sm"
              variant="secondary"
              :disabled="job.isRunning"
              :loading="jobsBusy === job.name"
              @click="runJob(job)"
            >
              {{ job.isRunning ? 'Идёт…' : 'Запустить' }}
            </UiButton>
          </div>

          <p v-if="!jobs.length" class="muted">Заданий для этого источника нет.</p>
        </section>

        <div class="advanced-actions">
          <UiButton
            :loading="controlBusy === `settings-${expandedSourceRow.code}`"
            :disabled="!isDirty(expandedSourceRow)"
            @click="saveSourceSettings(expandedSourceRow.code)"
          >
            Сохранить настройки
          </UiButton>
          <span class="muted">
            Значение перекрывает переменную окружения; передеплой не нужен.
          </span>
        </div>
      </div>
    </UiCard>

    <!-- ---------------------------------------------------------- health -->
    <UiCard :padded="false">
      <template #header>
        <div class="card-head">
          <h2>Состояние кронов</h2>
          <p>
            Парсер считается «молчащим», если успешного запуска не было дольше
            {{ health?.maxAgeHours ?? 2 }} ч.
          </p>
        </div>
      </template>
      <template #actions>
        <UiBadge v-if="health" :tone="health.ok ? 'success' : 'danger'">
          {{ health.ok ? 'Всё в норме' : 'Требует внимания' }}
        </UiBadge>
      </template>

      <div v-if="health?.jobs.length" class="health-grid pad">
        <article v-for="job in health.jobs" :key="job.key" class="health-card" :class="`is-${job.health.toLowerCase()}`">
          <div class="health-top">
            <strong>{{ job.label }}</strong>
            <UiBadge :tone="HEALTH_TONE[job.health] || 'neutral'" size="sm">
              {{ HEALTH_LABEL[job.health] || job.health }}
            </UiBadge>
          </div>
          <dl class="health-meta">
            <div>
              <dt>Последний успех</dt>
              <dd :title="formatDateTime(job.lastSuccessAt)">{{ formatAgo(job.lastSuccessAt) }}</dd>
            </div>
            <div>
              <dt>Запусков</dt>
              <dd>{{ job.successes }} / {{ job.runs }}</dd>
            </div>
            <div v-if="job.failures">
              <dt>Сбоев</dt>
              <dd class="danger">{{ job.failures }}</dd>
            </div>
          </dl>
          <p v-if="job.lastError" class="health-error" :title="job.lastError">{{ job.lastError }}</p>
        </article>
      </div>
      <p v-else class="pad muted">Крон ещё не запускался после старта backend.</p>
    </UiCard>

    <!-- ------------------------------------------------------- run history -->
    <UiCard :padded="false">
      <template #header>
        <div class="card-head">
          <h2>История запусков</h2>
          <p>Последние 20 запусков — сколько шли и чем закончились.</p>
        </div>
      </template>

      <UiTable
        :columns="[
          { key: 'label', label: 'Парсер' },
          { key: 'status', label: 'Итог', width: '110px', nowrap: true },
          { key: 'startedAt', label: 'Старт', width: '150px', nowrap: true },
          { key: 'durationMs', label: 'Длительность', width: '130px', nowrap: true },
          { key: 'errorCount', label: 'Ошибок', width: '90px', align: 'end' }
        ]"
        :rows="runs"
        row-key="id"
        empty-text="Запусков ещё не было."
      >
        <template #cell-status="{ row }">
          <UiBadge
            size="sm"
            :tone="row.status === 'SUCCESS' ? 'success' : row.status === 'RUNNING' ? 'info' : 'danger'"
          >
            {{ row.status === 'SUCCESS' ? 'Успех' : row.status === 'RUNNING' ? 'Идёт' : 'Сбой' }}
          </UiBadge>
        </template>
        <template #cell-startedAt="{ row }">
          <span class="muted">{{ formatDateTime(row.startedAt) }}</span>
        </template>
        <template #cell-durationMs="{ row }">
          <span class="muted">{{ formatDuration(row.durationMs) }}</span>
        </template>
        <template #cell-errorCount="{ row }">
          <span :class="{ danger: row.errorCount > 0 }">{{ row.errorCount }}</span>
        </template>
      </UiTable>
    </UiCard>

    <!-- ------------------------------------------------------------ queues -->
    <UiCard :padded="false">
      <template #header>
        <div class="card-head">
          <h2>Очереди поставщиков</h2>
          <p>
            Всего по всем источникам: {{ totals.total }} URL —
            {{ totals.queued }} в очереди, {{ totals.visited }} обработано,
            {{ totals.failed }} с ошибкой, {{ totals.skipped }} пропущено.
          </p>
        </div>
      </template>

      <div class="pad">
        <UiTabs v-model="activeQueue" :tabs="queueTabs" />
      </div>

      <div :key="queue.key" class="queue-panel">
        <div class="stat-row pad">
          <div class="stat">
            <strong>{{ queue.stats.value?.queued ?? '—' }}</strong><span>в очереди</span>
          </div>
          <div class="stat">
            <strong>{{ queue.stats.value?.visited ?? '—' }}</strong><span>обработано</span>
          </div>
          <div class="stat is-danger">
            <strong>{{ queue.stats.value?.failed ?? '—' }}</strong><span>с ошибкой</span>
          </div>
          <div class="stat">
            <strong>{{ queue.stats.value?.skipped ?? '—' }}</strong><span>пропущено</span>
          </div>
          <div class="stat">
            <strong>{{ queue.stats.value?.total ?? '—' }}</strong><span>всего</span>
          </div>
        </div>

        <div class="toolbar pad">
          <div class="toolbar-actions">
            <UiButton size="sm" :loading="queue.busy.value === 'refresh'" @click="queue.refresh()">
              Загрузить sitemap
            </UiButton>
            <UiButton
              size="sm"
              variant="secondary"
              :loading="queue.busy.value === 'process'"
              @click="queue.process()"
            >
              Обработать 25
            </UiButton>
            <UiButton
              size="sm"
              variant="secondary"
              :loading="queue.busy.value === 'retry-problems'"
              :disabled="!queue.stats.value?.failed && !queue.stats.value?.skipped"
              @click="queue.retryProblems()"
            >
              Повторить проблемные
            </UiButton>
          </div>

          <form class="toolbar-filters" @submit.prevent="queue.applyFilters()">
            <UiInput v-model="queue.filters.search" size="sm" placeholder="Поиск по URL" />
            <UiSelect v-model="queue.filters.status" size="sm" :options="STATUS_OPTIONS" />
            <UiButton type="submit" size="sm" variant="secondary">Найти</UiButton>
          </form>
        </div>

        <UiTable
          :columns="QUEUE_COLUMNS"
          :rows="queue.rows.value"
          row-key="id"
          :loading="queue.loading.value"
          empty-text="URL с таким фильтром нет."
        >
          <template #cell-url="{ row }">
            <a class="url" :href="row.url" target="_blank" rel="noreferrer">{{ row.url }}</a>
            <p v-if="row.lastError" class="row-error" :title="row.lastError">{{ row.lastError }}</p>
          </template>
          <template #cell-status="{ row }">
            <UiBadge size="sm" :tone="STATUS_TONE[row.status] || 'neutral'">{{ row.status }}</UiBadge>
          </template>
          <template #cell-lastTriedAt="{ row }">
            <span class="muted">{{ formatDateTime(row.lastTriedAt) }}</span>
          </template>
          <template #cell-actions="{ row }">
            <UiButton
              v-if="row.status === 'FAILED' || row.status === 'SKIPPED'"
              size="sm"
              variant="ghost"
              :loading="queue.busy.value === `retry-${row.id}`"
              @click="queue.retryOne(row.id)"
            >
              Повторить
            </UiButton>
          </template>
        </UiTable>

        <div class="pagination pad">
          <UiButton
            size="sm"
            variant="secondary"
            :disabled="queue.pagination.page <= 1"
            @click="queue.setPage(queue.pagination.page - 1)"
          >
            Назад
          </UiButton>
          <span class="muted">
            {{ queue.pagination.page }} / {{ queue.pagination.pages || 1 }}
            <template v-if="queue.pagination.total">· {{ queue.pagination.total }} URL</template>
          </span>
          <UiButton
            size="sm"
            variant="secondary"
            :disabled="queue.pagination.page >= queue.pagination.pages"
            @click="queue.setPage(queue.pagination.page + 1)"
          >
            Вперёд
          </UiButton>
        </div>
      </div>
    </UiCard>

    <!-- -------------------------------------------------- category queue -->
    <UiCard v-if="categorySources.length" :padded="false">
      <template #header>
        <div class="card-head">
          <h2>Очередь категорий</h2>
          <p>
            Обход категорий поставщика находит товары, которых ещё нет в sitemap,
            и складывает их в очередь товаров. Выключенная категория не обходится,
            и товары из неё (включая подкатегории) не импортируются.
          </p>
        </div>
      </template>

      <div v-if="categorySources.length > 1" class="pad">
        <UiTabs
          v-model="categorySource"
          :tabs="categorySources.map(source => ({
            value: source.code,
            label: source.name,
            count: source.categories?.queued ?? null,
          }))"
        />
      </div>

      <div class="stat-row pad">
        <div class="stat">
          <strong>{{ categoryStats?.queued ?? '—' }}</strong><span>в очереди</span>
        </div>
        <div class="stat">
          <strong>{{ categoryStats?.visited ?? '—' }}</strong><span>обойдено</span>
        </div>
        <div class="stat is-danger">
          <strong>{{ categoryStats?.failed ?? '—' }}</strong><span>с ошибкой</span>
        </div>
        <div class="stat">
          <strong>{{ categoryStats?.disabled ?? '—' }}</strong><span>выключено</span>
        </div>
        <div class="stat">
          <strong>{{ categoryStats?.productsQueued ?? '—' }}</strong><span>товаров найдено</span>
        </div>
      </div>

      <div class="toolbar pad">
        <div class="toolbar-actions">
          <UiButton size="sm" :loading="categoryBusy === 'refresh'" @click="refreshCategories()">
            Загрузить категории
          </UiButton>
          <UiButton
            size="sm"
            variant="secondary"
            :loading="categoryBusy === 'process'"
            @click="processCategories()"
          >
            Обойти 3
          </UiButton>
          <UiButton
            size="sm"
            variant="secondary"
            :loading="categoryBusy === 'retry-problems'"
            :disabled="!categoryStats?.failed && !categoryStats?.skipped"
            @click="retryProblemCategories()"
          >
            Повторить проблемные
          </UiButton>
          <UiButton
            size="sm"
            variant="ghost"
            :loading="categoryBusy === 'reset'"
            @click="resetCategories()"
          >
            Переобойти все
          </UiButton>
        </div>

        <form class="toolbar-filters" @submit.prevent="applyCategoryFilters()">
          <UiInput v-model="categoryFilters.search" size="sm" placeholder="Поиск по категории" />
          <UiSelect v-model="categoryFilters.status" size="sm" :options="CATEGORY_STATUS_OPTIONS" />
          <UiButton type="submit" size="sm" variant="secondary">Найти</UiButton>
        </form>
      </div>

      <UiTable
        :columns="CATEGORY_COLUMNS"
        :rows="categoryRows"
        row-key="id"
        :loading="categoryLoading"
        empty-text="Категорий с таким фильтром нет. Нажмите «Загрузить категории»."
      >
        <template #cell-name="{ row }">
          <a class="url" :href="row.url" target="_blank" rel="noreferrer">
            <span class="muted">{{ row.path.slice(0, -1).join(' / ') }}</span>
            <strong>{{ row.name }}</strong>
          </a>
          <p v-if="row.lastError" class="row-error" :title="row.lastError">{{ row.lastError }}</p>
        </template>
        <template #cell-status="{ row }">
          <UiBadge v-if="!row.isEnabled" size="sm" tone="neutral">Выключена</UiBadge>
          <UiBadge v-else size="sm" :tone="STATUS_TONE[row.status] || 'neutral'">{{ row.status }}</UiBadge>
        </template>
        <template #cell-productsFound="{ row }">
          {{ row.productsFound }}
          <p v-if="row.pagesCrawled" class="muted hint">{{ row.pagesCrawled }} стр.</p>
        </template>
        <template #cell-visitedAt="{ row }">
          <span class="muted">{{ formatDateTime(row.visitedAt) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <div class="row-actions">
            <UiButton
              size="sm"
              variant="ghost"
              :loading="categoryBusy === `toggle-${row.id}`"
              @click="toggleCategory(row)"
            >
              {{ row.isEnabled ? 'Не парсить' : 'Парсить' }}
            </UiButton>
            <UiButton
              v-if="row.status !== 'PENDING'"
              size="sm"
              variant="ghost"
              :loading="categoryBusy === `retry-${row.id}`"
              @click="retryCategory(row.id)"
            >
              Обойти
            </UiButton>
          </div>
        </template>
      </UiTable>

      <div class="pagination pad">
        <UiButton
          size="sm"
          variant="secondary"
          :disabled="categoryPagination.page <= 1"
          @click="setCategoryPage(categoryPagination.page - 1)"
        >
          Назад
        </UiButton>
        <span class="muted">
          {{ categoryPagination.page }} / {{ categoryPagination.pages || 1 }}
          <template v-if="categoryPagination.total">· {{ categoryPagination.total }} категорий</template>
        </span>
        <UiButton
          size="sm"
          variant="secondary"
          :disabled="categoryPagination.page >= categoryPagination.pages"
          @click="setCategoryPage(categoryPagination.page + 1)"
        >
          Вперёд
        </UiButton>
      </div>
    </UiCard>

    <!-- --------------------------------------------------- supplier summary -->
    <UiCard :padded="false">
      <template #header>
        <div class="card-head">
          <h2>Каталог по источникам</h2>
          <p>Сколько товаров поставщика видно на витрине и где не хватает базовых данных.</p>
        </div>
      </template>

      <UiTable
        :columns="[
          { key: 'name', label: 'Источник' },
          { key: 'published', label: 'На витрине', width: '120px', align: 'end' },
          { key: 'total', label: 'Всего', width: '90px', align: 'end' },
          { key: 'gaps', label: 'Пробелы в данных', width: '260px' }
        ]"
        :rows="supplierSummary"
        empty-text="Источников пока нет."
      >
        <template #cell-name="{ row }">
          <strong>{{ row.source.name }}</strong>
          <span class="code">{{ row.source.code }}</span>
        </template>
        <template #cell-published="{ row }">
          {{ row.published }}
          <UiBadge v-if="row.draft" tone="warning" size="sm">+{{ row.draft }} черновиков</UiBadge>
        </template>
        <template #cell-total="{ row }">
          <span :title="`скрыто: ${row.hidden}, в архиве: ${row.archived}`">{{ row.total }}</span>
        </template>
        <template #cell-gaps="{ row }">
          <div class="gaps">
            <UiBadge :tone="row.withoutImages ? 'danger' : 'neutral'" size="sm">
              без фото: {{ row.withoutImages }}
            </UiBadge>
            <UiBadge :tone="row.withoutPrice ? 'danger' : 'neutral'" size="sm">
              без цены: {{ row.withoutPrice }}
            </UiBadge>
            <UiBadge :tone="row.withoutSku ? 'warning' : 'neutral'" size="sm">
              без SKU: {{ row.withoutSku }}
            </UiBadge>
          </div>
        </template>
      </UiTable>
    </UiCard>

    <!-- ------------------------------------------------------ data quality -->
    <UiCard :padded="false">
      <template #header>
        <div class="card-head">
          <h2>Качество данных</h2>
          <p>
            Опубликовано {{ dataQuality?.summary.publishedProducts ?? '—' }} из
            {{ dataQuality?.summary.totalProducts ?? '—' }} товаров.
            Отчёт от {{ dataQuality ? formatDateTime(dataQuality.generatedAt) : '…' }}.
          </p>
        </div>
      </template>
      <template #actions>
        <UiButton variant="secondary" size="sm" :loading="dataQualityLoading" @click="loadDataQuality()">
          Пересчитать
        </UiButton>
      </template>

      <div v-if="dataQuality" class="quality-grid pad">
        <details v-for="metric in qualityMetrics" :key="metric.key" class="quality-item" :class="{ ok: !metric.count }">
          <summary>
            <strong>{{ metric.count }}</strong>
            <span>{{ metric.label }}</span>
          </summary>
          <ul v-if="metric.items.length">
            <li v-for="item in metric.items" :key="item.id">
              <a :href="`/product/${item.slug}`" target="_blank" rel="noreferrer">{{ item.name }}</a>
            </li>
            <li v-if="metric.count > metric.items.length" class="muted">
              … и ещё {{ metric.count - metric.items.length }}
            </li>
          </ul>
          <p v-else class="muted">Проблем нет.</p>
        </details>

        <details class="quality-item" :class="{ ok: !dataQuality.summary.duplicateGroups }">
          <summary>
            <strong>{{ dataQuality.summary.duplicateGroups }}</strong>
            <span>Возможные дубли</span>
          </summary>
          <ul v-if="dataQuality.samples.duplicates.length">
            <li v-for="group in dataQuality.samples.duplicates" :key="group.key" class="dup-group">
              <strong>{{ group.key }}</strong>
              <a
                v-for="item in group.products"
                :key="item.id"
                :href="`/product/${item.slug}`"
                target="_blank"
                rel="noreferrer"
              >
                {{ item.name }}
                <small v-if="item.sources.length">({{ item.sources.join(', ') }})</small>
              </a>
            </li>
          </ul>
          <p v-else class="muted">Дубликатов не найдено.</p>
        </details>
      </div>
      <p v-else class="pad muted">
        {{ dataQualityLoading ? 'Считаем отчёт…' : 'Отчёт ещё не загружен.' }}
      </p>
    </UiCard>

    <!-- ------------------------------------------------------------ import -->
    <UiCard>
      <template #header>
        <div class="card-head">
          <h2>Добавить товар из источника</h2>
          <p>Ссылка на карточку товара у поставщика — товар будет спарсен в каталог.</p>
        </div>
      </template>

      <form class="import-form" @submit.prevent="importProduct">
        <UiSelect
          v-model="importForm.sourceId"
          placeholder="Источник"
          :options="sources.map(source => ({ value: source.id, label: source.name }))"
        />
        <UiInput v-model="importForm.url" type="url" placeholder="https://…" />
        <UiButton type="submit" :loading="importing" :disabled="!importForm.sourceId || !importForm.url">
          Добавить
        </UiButton>
      </form>
      <p v-if="!sources.length" class="muted">Источники не найдены — сначала заведите источник.</p>
    </UiCard>

    <!-- -------------------------------------------------------- error log -->
    <UiCard :padded="false">
      <template #header>
        <div class="card-head">
          <h2>Лог ошибок парсинга</h2>
          <p>{{ errorCountLabel }} записей, новые сверху. Хранятся последние {{ ERROR_LOG_CAP }}.</p>
        </div>
      </template>
      <template #actions>
        <UiButton variant="secondary" size="sm" :disabled="!errors.length" @click="clearErrors()">
          Очистить
        </UiButton>
      </template>

      <UiTable
        :columns="[
          { key: 'createdAt', label: 'Когда', width: '150px', nowrap: true },
          { key: 'message', label: 'Ошибка' },
          { key: 'url', label: 'URL' }
        ]"
        :rows="errors"
        empty-text="Ошибок пока нет."
      >
        <template #cell-createdAt="{ row }">
          <span class="muted">{{ formatDateTime(row.createdAt) }}</span>
        </template>
        <template #cell-message="{ row }">
          <span class="danger">{{ row.message }}</span>
        </template>
        <template #cell-url="{ row }">
          <a class="url" :href="row.url" target="_blank" rel="noreferrer">{{ row.url }}</a>
        </template>
      </UiTable>
    </UiCard>
  </div>
</template>

<style scoped>
.admin-parsing {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.head h1 {
  font-size: var(--text-2xl);
}

.head p,
.card-head p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.card-head h2 {
  font-size: var(--text-md);
}

.pad {
  padding: var(--space-4);
}

.muted {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.danger {
  color: var(--danger);
}

.url {
  color: var(--text-link);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

/* ---- Control ---- */
.batch-form {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.batch-form :deep(input) {
  width: 80px;
}

.save-btn {
  margin-left: var(--space-2);
}

.advanced {
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-muted);
}

.advanced h3 {
  margin-bottom: var(--space-3);
  font-size: var(--text-base);
  color: var(--text-strong);
}

.advanced-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}

.advanced label,
.advanced-full {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-3);
}

.advanced label > span {
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 600;
}

.advanced small {
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.4;
}

.jobs {
  padding-top: var(--space-4);
  margin-bottom: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

.jobs h4 {
  margin-bottom: var(--space-1);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-strong);
}

.job {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.job:last-of-type {
  border-bottom: 0;
}

.job-info strong {
  color: var(--text-strong);
}

.job-state {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

@media (max-width: 720px) {
  .job {
    grid-template-columns: 1fr auto;
  }

  .job-state {
    grid-column: 1 / -1;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
  }
}

.advanced-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.hint {
  margin-top: 2px;
  font-size: var(--text-xs);
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-1);
}

/* ---- Health ---- */
.health-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-3);
}

.health-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.health-card.is-ok { border-left-color: var(--success); }
.health-card.is-running { border-left-color: var(--info); }
.health-card.is-error { border-left-color: var(--danger); }
.health-card.is-stale { border-left-color: var(--warning); }

.health-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.health-top strong {
  overflow: hidden;
  color: var(--text-strong);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0;
}

.health-meta dt {
  color: var(--text-subtle);
  font-size: var(--text-xs);
  text-transform: uppercase;
}

.health-meta dd {
  margin: 0;
  color: var(--text-default);
  font-size: var(--text-sm);
  font-weight: 600;
}

.health-error {
  display: -webkit-box;
  overflow: hidden;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger-soft-text);
  font-size: var(--text-xs);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

/* ---- Queues ---- */
.queue-panel {
  border-top: 1px solid var(--border-subtle);
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: var(--space-3);
}

.stat {
  display: flex;
  flex-direction: column;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.stat strong {
  color: var(--text-strong);
  font-size: var(--text-xl);
  font-weight: 800;
  line-height: 1.1;
}

.stat span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.stat.is-danger strong {
  color: var(--danger);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: 0;
}

.toolbar-actions,
.toolbar-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.toolbar-filters :deep(.ui-input) {
  width: 220px;
}

.toolbar-filters :deep(.ui-select) {
  width: 160px;
}

.row-error {
  display: -webkit-box;
  overflow: hidden;
  margin-top: var(--space-1);
  color: var(--danger);
  font-size: var(--text-xs);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  border-top: 1px solid var(--border-subtle);
}

/* ---- Supplier summary ---- */
.code {
  margin-left: var(--space-2);
  color: var(--text-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.gaps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* ---- Data quality ---- */
.quality-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-3);
}

.quality-item {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.quality-item summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  cursor: pointer;
  list-style: none;
}

.quality-item summary::-webkit-details-marker {
  display: none;
}

.quality-item summary strong {
  color: var(--danger);
  font-size: var(--text-2xl);
  font-weight: 800;
  line-height: 1;
}

.quality-item summary span {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.quality-item.ok summary strong {
  color: var(--success);
}

.quality-item ul {
  display: grid;
  max-height: 240px;
  gap: var(--space-1);
  margin: var(--space-3) 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  font-size: var(--text-sm);
}

.quality-item a {
  color: var(--text-link);
  overflow-wrap: anywhere;
}

.dup-group {
  display: grid;
  gap: var(--space-1);
  padding-top: var(--space-2);
  border-top: 1px dashed var(--border-subtle);
}

.dup-group a {
  display: block;
}

/* ---- Import ---- */
.import-form {
  display: grid;
  gap: var(--space-2);
}

@media (min-width: 720px) {
  .import-form {
    grid-template-columns: 240px minmax(0, 1fr) auto;
  }
}
</style>
