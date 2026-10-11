<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type ErrorEntry = {
  id: string
  statusCode: number
  method: string
  path: string
  kind: string
  message: string
  detail: { message?: string[] } | null
  stack: string | null
  payload: unknown
  actorLabel: string | null
  ip: string | null
  userAgent: string | null
  occurrences: number
  createdAt: string
  lastSeenAt: string
}

type Response = {
  data: ErrorEntry[]
  serverErrors24h: number
  pagination: { page: number, limit: number, total: number, pages: number }
}

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()

const entries = ref<ErrorEntry[]>([])
const page = ref(1)
const pages = ref(1)
const total = ref(0)
const serverErrors24h = ref(0)
const loading = ref(false)
const loadError = ref('')
const clearing = ref(false)
const confirmClear = ref(false)

const filters = reactive({
  kind: '' as '' | 'server' | 'client',
  search: '',
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await adminFetch<Response>('/errors', {
      params: {
        page: page.value,
        kind: filters.kind || undefined,
        search: filters.search.trim() || undefined,
      },
    })
    entries.value = response.data
    serverErrors24h.value = response.serverErrors24h
    page.value = response.pagination.page
    pages.value = response.pagination.pages
    total.value = response.pagination.total
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить журнал ошибок')
  } finally {
    loading.value = false
  }
}

onMounted(load)

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [filters.kind, filters.search],
  () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      page.value = 1
      void load()
    }, 300)
  }
)
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

function goToPage(next: number) {
  page.value = next
  void load()
}

async function clearLog() {
  clearing.value = true
  try {
    const { removed } = await adminFetch<{ removed: number }>('/errors', {
      method: 'DELETE',
    })
    toast.success(`Журнал очищен: ${removed} записей`)
    confirmClear.value = false
    page.value = 1
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось очистить журнал'))
  } finally {
    clearing.value = false
  }
}

/* ---- Display ----------------------------------------------------------- */
const expanded = ref('')

const dateTimeFormatter = new Intl.DateTimeFormat('ru-BY', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
const formatDateTime = (iso: string) => dateTimeFormatter.format(new Date(iso))

const statusTone = (code: number) => (code >= 500 ? 'danger' : 'warning')

/** Validation failures arrive as a list; everything else is one sentence. */
const messageLines = (row: ErrorEntry) =>
  row.detail?.message?.length ? row.detail.message : [row.message]

const payloadFull = (payload: unknown) => JSON.stringify(payload, null, 2)
</script>

<template>
  <div class="admin-errors">
    <header class="head">
      <div>
        <h1>Ошибки API</h1>
        <p>
          Все ответы 5xx и те 4xx, которые получила сама админка — то есть
          случаи, когда экран должен был сработать и не сработал. Запросы
          витрины с кодами 401/403/404 сюда не попадают, иначе журнал утонет в
          обычном шуме. Пароли и токены в теле заменяются на «[redacted]»,
          записи старше 30 дней удаляются сами.
        </p>
      </div>
      <UiButton
        v-if="total"
        variant="ghost"
        size="sm"
        @click="confirmClear = true"
      >
        Очистить журнал
      </UiButton>
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <UiAlert v-else-if="serverErrors24h" tone="danger">
      За последние сутки серверных ошибок: {{ serverErrors24h }}. Это баг на
      нашей стороне — стоит посмотреть, что именно падает.
    </UiAlert>

    <UiAlert v-else-if="!total && !loading" tone="success">
      Ошибок нет — за всё время, что ведётся журнал.
    </UiAlert>

    <div class="filters">
      <UiInput
        v-model="filters.search"
        placeholder="Путь или текст ошибки"
        size="sm"
      />
      <UiSelect
        v-model="filters.kind"
        size="sm"
        :options="[
          { value: '', label: 'Все ошибки' },
          { value: 'server', label: '5xx — наша поломка' },
          { value: 'client', label: '4xx — запрос не прошёл' }
        ]"
      />
    </div>

    <UiTable
      :columns="[
        { key: 'lastSeenAt', label: 'Когда', width: '160px', nowrap: true },
        { key: 'request', label: 'Запрос', width: '260px' },
        { key: 'what', label: 'Что случилось' },
        { key: 'status', label: 'Код', width: '110px', nowrap: true }
      ]"
      :rows="entries"
      row-key="id"
      :loading="loading"
      empty-text="Записей нет."
    >
      <template #cell-lastSeenAt="{ row }">
        {{ formatDateTime(row.lastSeenAt) }}
        <p v-if="row.occurrences > 1" class="muted hint">
          повторилась {{ row.occurrences }} раз, впервые
          {{ formatDateTime(row.createdAt) }}
        </p>
      </template>

      <template #cell-request="{ row }">
        <div class="request">
          <UiBadge tone="neutral" size="sm">{{ row.method }}</UiBadge>
          <code class="path">{{ row.path }}</code>
        </div>
        <p v-if="row.actorLabel && row.actorLabel !== 'anonymous'" class="muted hint">
          {{ row.actorLabel }}<template v-if="row.ip"> · {{ row.ip }}</template>
        </p>
        <p v-else-if="row.ip" class="muted hint">{{ row.ip }}</p>
      </template>

      <template #cell-what="{ row }">
        <p v-for="line in messageLines(row)" :key="line" class="message">
          {{ line }}
        </p>
        <p class="muted hint">{{ row.kind }}</p>
        <button
          v-if="row.stack || row.payload"
          type="button"
          class="detail-toggle"
          @click="expanded = expanded === row.id ? '' : row.id"
        >
          {{ expanded === row.id ? 'скрыть подробности' : 'подробности' }}
        </button>
        <template v-if="expanded === row.id">
          <pre v-if="row.payload" class="detail">{{ payloadFull(row.payload) }}</pre>
          <pre v-if="row.stack" class="detail">{{ row.stack }}</pre>
        </template>
      </template>

      <template #cell-status="{ row }">
        <UiBadge :tone="statusTone(row.statusCode)" size="sm">
          {{ row.statusCode }}
        </UiBadge>
      </template>
    </UiTable>

    <UiPagination :page="page" :pages="pages" :total="total" @change="goToPage" />

    <UiModal
      :open="confirmClear"
      title="Очистить журнал ошибок?"
      size="sm"
      @update:open="confirmClear = false"
    >
      <p class="confirm-text">
        Удалятся все {{ total }} записей. Это разумно после того, как поломку
        починили — чтобы следующая ошибка была видна сразу.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="confirmClear = false">Отмена</UiButton>
        <UiButton variant="danger" :loading="clearing" @click="clearLog">
          Очистить
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.admin-errors {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.head h1 {
  font-size: var(--text-2xl);
}

.head p {
  max-width: 70ch;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.filters {
  display: grid;
  align-items: center;
  grid-template-columns: minmax(220px, 1fr) 240px;
  gap: var(--space-3);
}

.request {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.path {
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.message {
  overflow-wrap: anywhere;
  color: var(--text-strong);
  font-size: var(--text-sm);
}

.muted {
  color: var(--text-muted);
}

.hint {
  font-size: var(--text-xs);
}

.detail-toggle {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-align: left;
}

.detail-toggle:hover {
  color: var(--text-link);
}

.detail {
  max-height: 320px;
  padding: var(--space-3);
  margin-top: var(--space-2);
  overflow: auto;
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.confirm-text {
  margin-bottom: var(--space-4);
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
