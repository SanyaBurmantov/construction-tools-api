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
import type { Paginated } from '~/types/api'
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
const { run: runJobAction, busy: jobsBusy } = useAdminAction()
/** Polls while something is running, so a long crawl shows progress. */
let jobsTimer: ReturnType<typeof setInterval> | null = null

// Polled every 5 s and on every row switch: an answer for a source that is no
// longer open must not land in its place (the useAdminList ticket rule).
let jobsTicket = 0
async function loadJobs() {
  if (!hasSession.value || !expandedSource.value) return
  const ticket = ++jobsTicket
  try {
    const answer = await adminFetch<ParserJob[]>(`/parser/sources/${expandedSource.value}/jobs`)
    if (ticket === jobsTicket) jobs.value = answer
  } catch (error) {
    if (ticket === jobsTicket) toast.error(errorMessage(error, 'Не удалось загрузить задания'))
  }
}

/**
 * Fires the job and returns at once — a tools.by catalog crawl runs for about
 * a quarter of an hour, so the button reports "запущено", not "готово".
 */
const runJob = (job: ParserJob) =>
  runJobAction(
    () => adminFetch<{ started: boolean, reason?: string }>(
      `/parser/sources/${expandedSource.value}/jobs/${job.name}/run`,
      { method: 'POST' },
    ),
    {
      key: job.name,
      error: 'Не удалось запустить задание',
      after: (result) => {
        if (result.started) toast.success(`${job.label}: запущено, следите за статусом`)
        else toast.error(`${job.label}: уже выполняется`)
        return loadJobs()
      },
    },
  )

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

const { run: runControlAction, busy: controlBusy } = useAdminAction()
/** Edited separately from `control` so typing doesn't fight a reload. */
const drafts = reactive<Record<string, SourceDraft>>({})
/** What each draft was last seeded from — tells an edited draft from a stale one. */
const seededFrom: Record<string, SourceDraft> = {}
/** Which source has its advanced settings open. */
const expandedSource = ref('')

/**
 * `saved` names the source whose form was just stored: its draft is re-seeded
 * even though it differs from the previous server values, so a saved value
 * stops looking edited.
 */
async function loadControl(saved?: string) {
  if (!hasSession.value) return
  try {
    control.value = await adminFetch<ParserOverview>('/parser/overview')
    // Re-seed only the drafts nobody is editing. This runs on every 5 s poll
    // while a job is running and after every action, and re-seeding them all
    // wiped whatever was being typed into another source's form.
    for (const source of control.value.sources) {
      const next = draftFromSource(source)
      const draft = drafts[source.code]
      const previous = seededFrom[source.code]
      if (!draft || !previous || source.code === saved || sameDraft(draft, previous)) {
        drafts[source.code] = { ...next }
      }
      seededFrom[source.code] = next
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

const runControl = (action: string, request: () => Promise<string>, saved?: string) =>
  runControlAction(request, {
    key: action,
    error: 'Не удалось изменить настройки',
    success: message => message,
    after: () => loadControl(saved),
  })

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
 * Saves the fields of the source form the admin actually changed. The backend
 * validates the regexes and answers 400 with the reason, so a broken filter
 * never reaches the parser — it would otherwise throw on every single product.
 *
 * Only the changed ones: the form holds the *effective* values (env and code
 * defaults included), and sending all of them copied each into a DB row that
 * outranks env — after one batch-size change, edits to the category regexes in
 * compose or in parser-defaults.ts were silently ignored for that source.
 */
const saveSourceSettings = (code: string) =>
  runControl(`settings-${code}`, async () => {
    const draft = drafts[code]!
    const seeded = seededFrom[code]
    const source = control.value?.sources.find(item => item.code === code)
    const changed = <K extends keyof SourceDraft>(key: K) =>
      !seeded || String(draft[key] ?? '') !== String(seeded[key] ?? '')
    const body: Record<string, unknown> = {}
    if (changed('batchLimit')) body.batchLimit = Number(draft.batchLimit)
    if (changed('requestDelayMs')) body.requestDelayMs = Number(draft.requestDelayMs)
    if (changed('maxPages')) body.maxPages = Number(draft.maxPages)
    // Only a source that crawls categories has this setting (the API
    // validates `Min(1)`).
    if (source?.categoryBatchLimit !== undefined && changed('categoryBatchLimit'))
      body.categoryBatchLimit = Number(draft.categoryBatchLimit)
    if (changed('categoryIncludeRegex')) body.categoryIncludeRegex = draft.categoryIncludeRegex
    if (changed('categoryExcludeRegex')) body.categoryExcludeRegex = draft.categoryExcludeRegex
    if (!Object.keys(body).length) return `${code}: изменений нет`
    await adminFetch(`/parser/sources/${code}`, { method: 'PATCH', body })
    return `${code}: настройки сохранены`
  }, code)

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
const { run: runCategory, busy: categoryBusy } = useAdminAction()

const categoryStats = computed(() =>
  categorySources.value.find(source => source.code === categorySource.value)?.categories ?? null
)

let categoriesTicket = 0
async function loadCategories() {
  if (!hasSession.value) return
  categoryLoading.value = true
  // A quick tab switch must not leave source A's rows under tab B.
  const ticket = ++categoriesTicket
  try {
    const response = await adminFetch<Paginated<CategoryRow>>('/parser/categories', {
      params: compactParams({
        source: categorySource.value,
        ...categoryFilters,
        page: categoryPagination.page,
        limit: categoryPagination.limit,
      }),
    })
    if (ticket !== categoriesTicket) return
    categoryRows.value = response.data
    Object.assign(categoryPagination, response.pagination)
  } catch (error) {
    if (ticket === categoriesTicket) toast.error(errorMessage(error, 'Не удалось загрузить очередь категорий'))
  } finally {
    if (ticket === categoriesTicket) categoryLoading.value = false
  }
}

const runCategoryAction = (action: string, request: () => Promise<string>) =>
  runCategory(request, {
    key: action,
    error: 'Не удалось выполнить действие',
    success: message => message,
    after: () => Promise.all([loadCategories(), loadControl()]),
  })

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
    if (!importForm.sourceId && nextSources.length === 1) importForm.sourceId = nextSources[0]!.id
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось загрузить состояние парсеров'))
  } finally {
    overviewLoading.value = false
  }
}

/**
 * The header's "Обновить состояние" is the one button an operator presses, so
 * it refreshes the switches too, not just the health cards. Kept out of
 * `loadOverview()` itself, which mount used to follow with a second
 * `/parser/overview` of its own.
 */
const refreshState = () => Promise.all([loadOverview(), loadControl()])

const { run: runPageAction } = useAdminAction()

const clearErrors = () =>
  runPageAction(() => adminFetch('/queue/errors', { method: 'DELETE' }), {
    error: 'Не удалось очистить лог',
    success: 'Лог ошибок очищен',
    after: loadOverview,
  })

/* ---------------------------------------------------------------- import */

const importForm = reactive({ sourceId: null as string | null, url: '' })
const importing = ref(false)

async function importProduct() {
  if (!importForm.sourceId || !importForm.url) return
  importing.value = true
  await runPageAction(
    () => adminFetch<{ product: { name: string } }>('/source-products/import', {
      method: 'POST',
      body: { ...importForm },
    }),
    {
      error: 'Не удалось добавить товар из источника',
      success: result => `Товар добавлен: ${result.product.name}`,
      after: () => { importForm.url = '' },
    },
  )
  importing.value = false
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
  <div class="admin-page admin-parsing">
    <AdminPageHead
      title="Парсинг"
      description="Состояние кронов, очереди поставщиков и качество импортированных данных."
    >
      <UiButton variant="secondary" size="sm" :loading="overviewLoading" @click="refreshState()">
        Обновить состояние
      </UiButton>
    </AdminPageHead>

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
/*
 * The chrome every panel shares — card headers, paddings, the muted/danger
 * text, the stat strip and the toolbars. It lives here, reaching
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
</style>
