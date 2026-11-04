<script setup lang="ts">
// Seconds matter: a burst of the same error is read by its timestamps.
import type { Paginated } from '~/types/api'
import { formatDateTimeWithSeconds as formatDateTime } from '~/utils/format-datetime'

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

type Response = Paginated<ErrorEntry> & { serverErrors24h: number, browserErrors24h: number }

const { adminFetch } = useAdminApi()
const { run, busy } = useAdminAction()

const serverErrors24h = ref(0)
const browserErrors24h = ref(0)
const confirmClear = ref(false)

const filters = reactive({
  kind: '' as '' | 'server' | 'client' | 'browser',
  search: '',
})

const { rows: entries, pagination, loading, error: loadError, setPage } = useAdminList<
  ErrorEntry,
  Response
>('/errors', {
  params: () => ({ ...filters }),
  limit: 50,
  errorText: 'Не удалось загрузить журнал ошибок',
  onResponse: (response) => {
    serverErrors24h.value = response.serverErrors24h
    browserErrors24h.value = response.browserErrors24h ?? 0
  },
})

async function clearLog() {
  const done = await run(() => adminFetch<{ removed: number }>('/errors', { method: 'DELETE' }), {
    error: 'Не удалось очистить журнал',
    success: ({ removed }) => `Журнал очищен: ${removed} записей`,
    after: () => setPage(1),
  })
  if (done) confirmClear.value = false
}

/* ---- Display ----------------------------------------------------------- */
const expanded = ref('')

/** Validation failures arrive as a list; everything else is one sentence. */
const messageLines = (row: ErrorEntry) =>
  row.detail?.message?.length ? row.detail.message : [row.message]

const payloadFull = (payload: unknown) => JSON.stringify(payload, null, 2)

/** statusCode 0 = a visitor's browser (POST /client-errors), not an HTTP answer. */
const isBrowser = (row: ErrorEntry) => row.statusCode === 0
</script>

<template>
  <div class="admin-page admin-errors">
    <AdminPageHead
      title="Ошибки"
      description="Все ответы API 5xx и те 4xx, которые получила сама админка — то есть случаи, когда экран должен был сработать и не сработал, — и ошибки JavaScript в браузерах посетителей («Браузер»: кнопка, которая у кого-то не нажимается). Запросы витрины с кодами 401/403/404 сюда не попадают, иначе журнал утонет в обычном шуме. Пароли и токены в теле заменяются на «[redacted]», записи старше 30 дней удаляются сами."
    >
      <UiButton
        v-if="pagination.total"
        variant="ghost"
        size="sm"
        @click="confirmClear = true"
      >
        Очистить журнал
      </UiButton>
    </AdminPageHead>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <UiAlert v-else-if="serverErrors24h" tone="danger">
      За последние сутки серверных ошибок: {{ serverErrors24h }}. Это баг на
      нашей стороне — стоит посмотреть, что именно падает.
    </UiAlert>

    <UiAlert v-else-if="browserErrors24h && filters.kind !== 'browser'" tone="warning">
      За сутки у посетителей было {{ browserErrors24h }} разных ошибок JavaScript —
      фильтр «Браузер» покажет, на каких страницах и в каких браузерах.
    </UiAlert>

    <UiAlert v-else-if="!pagination.total && !loading" tone="success">
      Ошибок нет — за всё время, что ведётся журнал.
    </UiAlert>

    <div class="filters">
      <UiInput
        v-model="filters.search"
        placeholder="Путь или текст ошибки"
        aria-label="Поиск ошибок"
        size="sm"
      />
      <UiSelect
        v-model="filters.kind"
        size="sm"
        :options="[
          { value: '', label: 'Все ошибки' },
          { value: 'server', label: '5xx — наша поломка' },
          { value: 'client', label: '4xx — запрос не прошёл' },
          { value: 'browser', label: 'Браузер — ошибки JS у посетителей' }
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
        <p v-if="row.occurrences > 1" class="admin-muted hint">
          повторилась {{ row.occurrences }} раз, впервые
          {{ formatDateTime(row.createdAt) }}
        </p>
      </template>

      <template #cell-request="{ row }">
        <div class="request">
          <UiBadge tone="neutral" size="sm">{{ row.method }}</UiBadge>
          <code class="path">{{ row.path }}</code>
        </div>
        <p v-if="isBrowser(row) && row.userAgent" class="admin-muted hint">{{ row.userAgent }}</p>
        <p v-else-if="row.actorLabel && row.actorLabel !== 'anonymous'" class="admin-muted hint">
          {{ row.actorLabel }}<template v-if="row.ip"> · {{ row.ip }}</template>
        </p>
        <p v-else-if="row.ip" class="admin-muted hint">{{ row.ip }}</p>
      </template>

      <template #cell-what="{ row }">
        <p v-for="line in messageLines(row)" :key="line" class="message">
          {{ line }}
        </p>
        <p class="admin-muted hint">{{ row.kind }}</p>
        <button
          v-if="row.stack || row.payload || (isBrowser(row) && row.detail)"
          type="button"
          class="detail-toggle"
          @click="expanded = expanded === row.id ? '' : row.id"
        >
          {{ expanded === row.id ? 'скрыть подробности' : 'подробности' }}
        </button>
        <template v-if="expanded === row.id">
          <pre v-if="row.payload" class="detail">{{ payloadFull(row.payload) }}</pre>
          <pre v-if="isBrowser(row) && row.detail" class="detail">{{ payloadFull(row.detail) }}</pre>
          <pre v-if="row.stack" class="detail">{{ row.stack }}</pre>
        </template>
      </template>

      <template #cell-status="{ row }">
        <UiBadge v-if="isBrowser(row)" tone="warning" size="sm">JS</UiBadge>
        <UiBadge v-else :tone="httpStatusTone(row.statusCode)" size="sm">
          {{ row.statusCode }}
        </UiBadge>
      </template>
    </UiTable>

    <UiPagination
      :page="pagination.page"
      :pages="pagination.pages"
      :total="pagination.total"
      @change="setPage"
    />

    <UiConfirm
      v-model:open="confirmClear"
      title="Очистить журнал ошибок?"
      confirm-label="Очистить"
      :busy="Boolean(busy)"
      @confirm="clearLog"
    >
      Удалятся все {{ pagination.total }} записей. Это разумно после того, как поломку
      починили — чтобы следующая ошибка была видна сразу.
    </UiConfirm>
  </div>
</template>

<style scoped>
.admin-errors :deep(.admin-head p) {
  max-width: 70ch;
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

@media (max-width: 640px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
