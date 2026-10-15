<script setup lang="ts">
import type {
  BulkRetryResponse,
  CategoryRow,
  DataQualityReport,
  ParserError,
  ParserHealth,
  ParserJob,
  ParserOverview,
  ParserRun,
  ParserSourceOverview,
  Source,
  SourceDraft,
  SupplierSummary,
} from '~/types/parsing'
import type { ParserQueue } from '~/composables/useParserQueue'
import { createParserQueue } from '~/composables/useParserQueue'

definePageMeta({ layout: 'admin' })

/**
 * The parsing control room.
 *
 * Every panel is a component under `components/admin/parsing/`; this page keeps
 * the state and the requests, so there is one place that knows what has been
 * loaded and one place that reloads it after an action. The split is purely
 * about size — the page was 2000 lines of five unrelated screens.
 */
const { hasSession, adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()
const nuxtApp = useNuxtApp()

/* ----------------------------------------------------------------- control */

const control = ref<ParserOverview | null>(null)
const jobs = ref<ParserJob[]>([])
const jobsBusy = ref('')
/** Polls while something is running, so a long crawl shows progress. */
let jobsTimer: ReturnType<typeof setInterval> | null = null

async function loadJobs() {
  if (!hasSession.value || !expandedSource.value) return
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

async function loadControl() {
  if (!hasSession.value) return
  try {
    control.value = await adminFetch<ParserOverview>('/parser/overview')
    // Re-seed drafts from the server so a saved value stops looking edited.
    for (const source of control.value.sources) {
      drafts[source.code] = {
        batchLimit: source.batchLimit,
        requestDelayMs: source.requestDelayMs,
        maxPages: source.maxPages,
        categoryBatchLimit: source.categoryBatchLimit ?? 0,
        categoryIncludeRegex: source.categoryFilters.include,
        categoryExcludeRegex: source.categoryFilters.exclude,
      }
    }
    // The queue tabs come from the same answer; a reload adds a source that
    // appeared and leaves the ones already loaded alone.
    void syncQueues(control.value.sources)
    // Same for the category queue: its default below names a source, and a
    // source that is no longer registered would leave the select on nothing.
    if (categorySources.value.length
      && !categorySources.value.some(source => source.code === categorySource.value)) {
      categorySource.value = categorySources.value[0]!.code
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
    const source = control.value?.sources.find(item => item.code === code)
    await adminFetch(`/parser/sources/${code}`, {
      method: 'PATCH',
      body: {
        batchLimit: Number(draft.batchLimit),
        requestDelayMs: Number(draft.requestDelayMs),
        maxPages: Number(draft.maxPages),
        // Sent only for a source that crawls categories: the API validates
        // `Min(1)`, and the others have no such setting to send.
        ...(source?.categoryBatchLimit !== undefined
          ? { categoryBatchLimit: Number(draft.categoryBatchLimit) }
          : {}),
        categoryIncludeRegex: draft.categoryIncludeRegex,
        categoryExcludeRegex: draft.categoryExcludeRegex,
      },
    })
    return `${code}: настройки сохранены`
  })

/* ------------------------------------------------------------------ queues */

/**
 * One queue per registered source, built from `/parser/overview` — which now
 * carries each source's host and the prefix its queue endpoints sit under.
 * This list used to be four hand-written lines, so a fifth supplier parsed
 * happily with no queue on screen, which looks exactly like «очередь не
 * появилась».
 */
const queues = shallowRef<ParserQueue[]>([])
const activeQueue = ref('')

function syncQueues(sources: ParserSourceOverview[]) {
  const existing = new Map(queues.value.map(item => [item.key, item]))
  queues.value = sources.map(source => existing.get(source.code)
    // The factory calls composables, and this runs after an await — where they
    // would no longer find the Nuxt instance on their own.
    ?? nuxtApp.runWithContext(() => createParserQueue(source)) as ParserQueue)

  if (!queues.value.some(item => item.key === activeQueue.value)) {
    activeQueue.value = queues.value[0]?.key ?? ''
  }
  // A queue already on screen keeps its rows and paging; only a new one loads.
  return Promise.all(
    queues.value.filter(item => !existing.has(item.key)).map(item => item.load())
  )
}

const queue = computed(() =>
  queues.value.find(item => item.key === activeQueue.value) ?? queues.value[0] ?? null
)

const queueTabs = computed(() =>
  queues.value.map(item => ({
    value: item.key,
    label: item.host,
    count: item.stats.value?.queued ?? null,
  }))
)

/** Totals across every source — the old page showed one source's numbers as if global. */
const totals = computed(() =>
  queues.value.reduce((acc, item) => {
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

/* ---------------------------------------------------------- category queue */

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

async function loadCategories() {
  if (!hasSession.value) return
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

async function loadOverview() {
  if (!hasSession.value) return
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
  if (!hasSession.value) return
  dataQualityLoading.value = true
  try {
    dataQuality.value = await adminFetch<DataQualityReport>('/data-quality')
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось загрузить отчёт качества'))
  } finally {
    dataQualityLoading.value = false
  }
}

onMounted(async () => {
  // Control first: it is what lists the sources — which ones have a category
  // crawler, and which queues exist at all.
  await loadControl()
  void loadCategories()
  void loadOverview()
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

    <AdminParsingSourceControl
      v-model:expanded-source="expandedSource"
      :control="control"
      :drafts="drafts"
      :busy="controlBusy"
      :jobs="jobs"
      :jobs-busy="jobsBusy"
      @toggle-cron="toggleCron"
      @toggle-source="toggleSource"
      @save="saveSourceSettings"
      @run-job="runJob"
    />

    <AdminParsingCronHealth :health="health" />

    <AdminParsingRunHistory :runs="runs" />

    <AdminParsingQueuePanel
      v-if="queue"
      v-model:active-queue="activeQueue"
      :queue="queue"
      :tabs="queueTabs"
      :totals="totals"
    />

    <AdminParsingCategoryQueuePanel
      v-if="categorySources.length"
      v-model:source="categorySource"
      :sources="categorySources"
      :stats="categoryStats"
      :rows="categoryRows"
      :pagination="categoryPagination"
      :filters="categoryFilters"
      :loading="categoryLoading"
      :busy="categoryBusy"
      @refresh="refreshCategories"
      @process="processCategories"
      @retry-problems="retryProblemCategories"
      @reset="resetCategories"
      @apply-filters="applyCategoryFilters"
      @set-page="setCategoryPage"
      @toggle="toggleCategory"
      @retry="retryCategory"
    />

    <AdminParsingSourceSummary :rows="supplierSummary" />

    <AdminParsingDataQuality
      :report="dataQuality"
      :loading="dataQualityLoading"
      @reload="loadDataQuality"
    />

    <AdminParsingImportProduct
      :sources="sources"
      :form="importForm"
      :importing="importing"
      @submit="importProduct"
    />

    <AdminParsingErrorLog :errors="errors" @clear="clearErrors" />
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

.head p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/*
 * The chrome every panel shares — card headers, paddings, the muted/danger
 * text, the stat strip, the toolbars and the pagers. It lives here, reaching
 * into the panels with `:deep()`, instead of being copied into nine scoped
 * stylesheets; each panel keeps only the styles that are its own.
 */
.admin-parsing :deep(.card-head h2) {
  font-size: var(--text-md);
}

.admin-parsing :deep(.card-head p) {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.admin-parsing :deep(.pad) {
  padding: var(--space-4);
}

.admin-parsing :deep(.muted) {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.admin-parsing :deep(.hint) {
  margin-top: 2px;
  font-size: var(--text-xs);
}

.admin-parsing :deep(.danger) {
  color: var(--danger);
}

.admin-parsing :deep(.url) {
  color: var(--text-link);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.admin-parsing :deep(.code) {
  margin-left: var(--space-2);
  color: var(--text-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.admin-parsing :deep(.row-error) {
  display: -webkit-box;
  overflow: hidden;
  margin-top: var(--space-1);
  color: var(--danger);
  font-size: var(--text-xs);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.admin-parsing :deep(.row-actions) {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-1);
}

.admin-parsing :deep(.stat-row) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: var(--space-3);
}

.admin-parsing :deep(.stat) {
  display: flex;
  flex-direction: column;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.admin-parsing :deep(.stat strong) {
  color: var(--text-strong);
  font-size: var(--text-xl);
  font-weight: 800;
  line-height: 1.1;
}

.admin-parsing :deep(.stat span) {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.admin-parsing :deep(.stat.is-danger strong) {
  color: var(--danger);
}

.admin-parsing :deep(.toolbar) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: 0;
}

.admin-parsing :deep(.toolbar-actions),
.admin-parsing :deep(.toolbar-filters) {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.admin-parsing :deep(.toolbar-filters .ui-input) {
  width: 220px;
}

.admin-parsing :deep(.toolbar-filters .ui-select) {
  width: 160px;
}

.admin-parsing :deep(.pagination) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  border-top: 1px solid var(--border-subtle);
}
</style>
