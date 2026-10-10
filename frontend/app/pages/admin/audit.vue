<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type AuditEntry = {
  id: string
  actorId: string | null
  actorLabel: string
  method: string
  path: string
  statusCode: number
  payload: unknown
  ip: string | null
  durationMs: number | null
  createdAt: string
  actor: { id: string, login: string, role: 'CUSTOMER' | 'ADMIN' } | null
}

type Response = {
  data: AuditEntry[]
  pagination: { page: number, limit: number, total: number, pages: number }
}

const { adminFetch, errorMessage } = useAdminApi()

const entries = ref<AuditEntry[]>([])
const page = ref(1)
const pages = ref(1)
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const filters = reactive({
  method: '' as '' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: '',
  onlyFailures: false,
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await adminFetch<Response>('/audit', {
      params: {
        page: page.value,
        method: filters.method || undefined,
        path: filters.path.trim() || undefined,
        onlyFailures: filters.onlyFailures ? 'true' : undefined,
      },
    })
    entries.value = response.data
    page.value = response.pagination.page
    pages.value = response.pagination.pages
    total.value = response.pagination.total
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить журнал')
  } finally {
    loading.value = false
  }
}

onMounted(load)

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [filters.method, filters.path, filters.onlyFailures],
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

const METHOD_TONE: Record<string, 'info' | 'warning' | 'danger' | 'neutral'> = {
  POST: 'info',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'danger',
}

const statusTone = (code: number) =>
  code >= 500 ? 'danger' : code >= 400 ? 'warning' : 'success'

/** Keeps the table readable: the full body is one click away. */
const payloadPreview = (payload: unknown) => {
  if (payload == null) return ''
  const text = JSON.stringify(payload)
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

const payloadFull = (payload: unknown) => JSON.stringify(payload, null, 2)
</script>

<template>
  <div class="admin-audit">
    <header class="head">
      <div>
        <h1>Журнал действий</h1>
        <p>
          Кто и что менял в панели управления. Пишутся только изменяющие
          запросы — пароли и токены в теле заменяются на «[redacted]».
          {{ total }} записей.
        </p>
      </div>
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div class="filters">
      <UiInput
        v-model="filters.path"
        placeholder="Путь, например users или pricing"
        size="sm"
      />
      <UiSelect
        v-model="filters.method"
        size="sm"
        :options="[
          { value: '', label: 'Все методы' },
          { value: 'POST', label: 'POST — создание' },
          { value: 'PATCH', label: 'PATCH — изменение' },
          { value: 'PUT', label: 'PUT — замена' },
          { value: 'DELETE', label: 'DELETE — удаление' }
        ]"
      />
      <UiCheckbox v-model="filters.onlyFailures" label="Только ошибки" />
    </div>

    <UiTable
      :columns="[
        { key: 'createdAt', label: 'Когда', width: '150px', nowrap: true },
        { key: 'actor', label: 'Кто', width: '180px' },
        { key: 'action', label: 'Что' },
        { key: 'status', label: 'Итог', width: '110px', nowrap: true }
      ]"
      :rows="entries"
      row-key="id"
      :loading="loading"
      empty-text="Записей нет — журнал наполняется по мере изменений."
    >
      <template #cell-createdAt="{ row }">
        {{ formatDateTime(row.createdAt) }}
      </template>

      <template #cell-actor="{ row }">
        <NuxtLink v-if="row.actor" :to="`/admin/users/${row.actor.id}`">
          {{ row.actor.login }}
        </NuxtLink>
        <span v-else class="muted">{{ row.actorLabel }}</span>
        <p v-if="row.ip" class="muted hint">{{ row.ip }}</p>
      </template>

      <template #cell-action="{ row }">
        <div class="action">
          <UiBadge :tone="METHOD_TONE[row.method] || 'neutral'" size="sm">
            {{ row.method }}
          </UiBadge>
          <code class="path">{{ row.path }}</code>
        </div>
        <button
          v-if="row.payload"
          type="button"
          class="payload-toggle"
          @click="expanded = expanded === row.id ? '' : row.id"
        >
          {{ expanded === row.id ? 'скрыть тело' : payloadPreview(row.payload) }}
        </button>
        <pre v-if="expanded === row.id" class="payload">{{ payloadFull(row.payload) }}</pre>
      </template>

      <template #cell-status="{ row }">
        <UiBadge :tone="statusTone(row.statusCode)" size="sm">
          {{ row.statusCode }}
        </UiBadge>
        <p v-if="row.durationMs != null" class="muted hint">{{ row.durationMs }} мс</p>
      </template>
    </UiTable>

    <UiPagination :page="page" :pages="pages" :total="total" @change="goToPage" />
  </div>
</template>

<style scoped>
.admin-audit {
  display: flex;
  flex-direction: column;
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
  grid-template-columns: minmax(220px, 1fr) 220px auto;
  gap: var(--space-3);
}

.action {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.path {
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.payload-toggle {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-align: left;
}

.payload-toggle:hover {
  color: var(--text-link);
}

.payload {
  max-height: 320px;
  padding: var(--space-3);
  margin-top: var(--space-2);
  overflow: auto;
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.muted {
  color: var(--text-muted);
}

.hint {
  font-size: var(--text-xs);
}

@media (max-width: 900px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
