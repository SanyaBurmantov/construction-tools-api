<script setup lang="ts">
import type { CategoryRow, CategoryStats, ParserSourceOverview } from '~/types/parsing'

/**
 * «Очередь категорий» — the supplier's own category tree.
 *
 * Crawling a category finds products the sitemap has not listed yet; switching
 * one off also stops importing products from it (including its subcategories),
 * so the toggle here is an import switch, not just a crawl switch.
 */
const props = defineProps<{
  sources: ParserSourceOverview[]
  source: string
  stats: CategoryStats | null
  rows: CategoryRow[]
  pagination: { page: number, limit: number, total: number, pages: number }
  /** Edited in place: the page owns it and reloads on «Найти». */
  filters: { search: string, status: string }
  loading: boolean
  busy: string
}>()

const emit = defineEmits<{
  'update:source': [string]
  'refresh': []
  'process': []
  'retry-problems': []
  'reset': []
  'apply-filters': []
  'set-page': [number]
  'toggle': [CategoryRow]
  'retry': [string]
}>()

// See `queuePanel.vue`: the filter inputs edit the page's own reactive object.
const filters = computed(() => props.filters)

const tabs = computed(() =>
  props.sources.map(source => ({
    value: source.code,
    label: source.name,
    count: source.categories?.queued ?? null,
  }))
)

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'PENDING', label: 'В очереди' },
  { value: 'DONE', label: 'Обойдена' },
  { value: 'PROBLEM', label: 'Проблемные' },
  { value: 'DISABLED', label: 'Выключенные' },
]

const COLUMNS = [
  { key: 'name', label: 'Категория' },
  { key: 'status', label: 'Статус', width: '120px', nowrap: true },
  { key: 'productsFound', label: 'Товаров', width: '110px', align: 'end' as const },
  { key: 'visitedAt', label: 'Обойдена', width: '150px', nowrap: true },
  { key: 'actions', label: '', width: '190px', align: 'end' as const },
]
</script>

<template>
  <UiCard :padded="false">
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

    <div v-if="sources.length > 1" class="pad">
      <UiTabs
        :model-value="source"
        :tabs="tabs"
        @update:model-value="value => emit('update:source', String(value))"
      />
    </div>

    <div class="stat-row pad">
      <div class="stat">
        <strong>{{ stats?.queued ?? '—' }}</strong><span>в очереди</span>
      </div>
      <div class="stat">
        <strong>{{ stats?.visited ?? '—' }}</strong><span>обойдено</span>
      </div>
      <div class="stat is-danger">
        <strong>{{ stats?.failed ?? '—' }}</strong><span>с ошибкой</span>
      </div>
      <div class="stat">
        <strong>{{ stats?.disabled ?? '—' }}</strong><span>выключено</span>
      </div>
      <div class="stat">
        <strong>{{ stats?.productsQueued ?? '—' }}</strong><span>товаров найдено</span>
      </div>
    </div>

    <div class="toolbar pad">
      <div class="toolbar-actions">
        <UiButton size="sm" :loading="busy === 'refresh'" @click="emit('refresh')">
          Загрузить категории
        </UiButton>
        <UiButton
          size="sm"
          variant="secondary"
          :loading="busy === 'process'"
          @click="emit('process')"
        >
          Обойти 3
        </UiButton>
        <UiButton
          size="sm"
          variant="secondary"
          :loading="busy === 'retry-problems'"
          :disabled="!stats?.failed && !stats?.skipped"
          @click="emit('retry-problems')"
        >
          Повторить проблемные
        </UiButton>
        <UiButton
          size="sm"
          variant="ghost"
          :loading="busy === 'reset'"
          @click="emit('reset')"
        >
          Переобойти все
        </UiButton>
      </div>

      <form class="toolbar-filters" @submit.prevent="emit('apply-filters')">
        <UiInput v-model="filters.search" size="sm" placeholder="Поиск по категории" />
        <UiSelect v-model="filters.status" size="sm" :options="STATUS_OPTIONS" />
        <UiButton type="submit" size="sm" variant="secondary">Найти</UiButton>
      </form>
    </div>

    <UiTable
      :columns="COLUMNS"
      :rows="rows"
      row-key="id"
      :loading="loading"
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
        <UiBadge v-else size="sm" :tone="QUEUE_STATUS_TONE[row.status] || 'neutral'">{{ row.status }}</UiBadge>
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
            :loading="busy === `toggle-${row.id}`"
            @click="emit('toggle', row)"
          >
            {{ row.isEnabled ? 'Не парсить' : 'Парсить' }}
          </UiButton>
          <UiButton
            v-if="row.status !== 'PENDING'"
            size="sm"
            variant="ghost"
            :loading="busy === `retry-${row.id}`"
            @click="emit('retry', row.id)"
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
        :disabled="pagination.page <= 1"
        @click="emit('set-page', pagination.page - 1)"
      >
        Назад
      </UiButton>
      <span class="muted">
        {{ pagination.page }} / {{ pagination.pages || 1 }}
        <template v-if="pagination.total">· {{ pagination.total }} категорий</template>
      </span>
      <UiButton
        size="sm"
        variant="secondary"
        :disabled="pagination.page >= pagination.pages"
        @click="emit('set-page', pagination.page + 1)"
      >
        Вперёд
      </UiButton>
    </div>
  </UiCard>
</template>
