<script setup lang="ts">
// Seconds matter: two admin actions a moment apart must be orderable.
import { formatDateTimeWithSeconds as formatDateTime } from '~/utils/format-datetime'

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

const filters = reactive({
  method: '' as '' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: '',
  onlyFailures: false,
})

const { rows: entries, pagination, loading, error: loadError, setPage } = useAdminList<AuditEntry>(
  '/audit',
  {
    params: () => ({ ...filters, onlyFailures: filters.onlyFailures ? 'true' : undefined }),
    limit: 50,
    errorText: 'Не удалось загрузить журнал',
  },
)

/* ---- Display ----------------------------------------------------------- */
const expanded = ref('')

const METHOD_TONE: Record<string, 'info' | 'warning' | 'danger' | 'neutral'> = {
  POST: 'info',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'danger',
}

/** Keeps the table readable: the full body is one click away. */
const payloadPreview = (payload: unknown) => {
  if (payload == null) return ''
  const text = JSON.stringify(payload)
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

const payloadFull = (payload: unknown) => JSON.stringify(payload, null, 2)
</script>

<template>
  <div class="admin-page admin-audit">
    <AdminPageHead title="Журнал действий">
      <template #description>
        Кто и что менял в панели управления. Пишутся только изменяющие
        запросы — пароли и токены в теле заменяются на «[redacted]».
        {{ pagination.total }} записей.
      </template>
    </AdminPageHead>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div class="filters">
      <UiInput
        v-model="filters.path"
        placeholder="Путь, например users или pricing"
        aria-label="Путь запроса"
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
        <span v-else class="admin-muted">{{ row.actorLabel }}</span>
        <p v-if="row.ip" class="admin-muted hint">{{ row.ip }}</p>
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
        <UiBadge :tone="httpStatusTone(row.statusCode)" size="sm">
          {{ row.statusCode }}
        </UiBadge>
        <p v-if="row.durationMs != null" class="admin-muted hint">{{ row.durationMs }} мс</p>
      </template>
    </UiTable>

    <UiPagination
      :page="pagination.page"
      :pages="pagination.pages"
      :total="pagination.total"
      @change="setPage"
    />
  </div>
</template>

<style scoped>
.admin-audit :deep(.admin-head p) {
  max-width: 70ch;
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

.hint {
  font-size: var(--text-xs);
}

@media (max-width: 900px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
