<script setup lang="ts">
import type { ParserQueue } from '~/composables/useParserQueue'
import type { QueueStats } from '~/types/parsing'

/**
 * «Очереди поставщиков» — the tabs and the panel of the selected queue.
 *
 * The queue object carries its own state and actions (`useParserQueue`); this
 * only renders one of them, so switching tabs is the page changing which queue
 * it hands over.
 */
const props = defineProps<{
  queue: ParserQueue
  tabs: Array<{ value: string, label: string, count: number | null }>
  totals: QueueStats
  activeQueue: string
}>()

/**
 * The search/status inputs write straight into the queue's own reactive state:
 * it is a controller this panel drives, not data it must leave alone. Through
 * a local reference because `vue/no-mutating-props` cannot tell the two apart.
 */
const filters = computed(() => props.queue.filters)

const emit = defineEmits<{ 'update:activeQueue': [string] }>()

const STATUS_OPTIONS = [
  { value: 'PROBLEM', label: 'Проблемные' },
  { value: '', label: 'Все статусы' },
  { value: 'PENDING', label: 'В очереди' },
  { value: 'DONE', label: 'Готово' },
  { value: 'FAILED', label: 'Ошибка' },
  { value: 'SKIPPED', label: 'Пропущено' },
]

const COLUMNS = [
  { key: 'url', label: 'URL' },
  { key: 'status', label: 'Статус', width: '120px', nowrap: true },
  { key: 'attempts', label: 'Попыток', width: '90px', align: 'end' as const },
  { key: 'lastTriedAt', label: 'Последняя попытка', width: '160px', nowrap: true },
  { key: 'actions', label: '', width: '110px', align: 'end' as const },
]
</script>

<template>
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
      <UiTabs
        :model-value="activeQueue"
        :tabs="tabs"
        @update:model-value="value => emit('update:activeQueue', String(value))"
      />
    </div>

    <!--
      Only the selected queue is rendered. Keeping all four mounted behind
      `v-show` meant four tables in the DOM for one visible panel, and the
      `:key` makes Vue rebuild the panel on switch instead of patching stale
      rows into it.
    -->
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
          <UiInput v-model="filters.search" size="sm" placeholder="Поиск по URL" />
          <UiSelect v-model="filters.status" size="sm" :options="STATUS_OPTIONS" />
          <UiButton type="submit" size="sm" variant="secondary">Найти</UiButton>
        </form>
      </div>

      <UiTable
        :columns="COLUMNS"
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
          <UiBadge size="sm" :tone="QUEUE_STATUS_TONE[row.status] || 'neutral'">{{ row.status }}</UiBadge>
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
</template>

<style scoped>
.queue-panel {
  border-top: 1px solid var(--border-subtle);
}
</style>
