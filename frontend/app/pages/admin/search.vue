<script setup lang="ts">
import { formatDateTime } from '~/utils/format-datetime'

definePageMeta({ layout: 'admin' })

/**
 * The search journal (backend `search-log/`): what visitors look for, what
 * finds nothing, what they click. «Ничего не найдено» is the useful list —
 * each line is a product to add, a synonym or a word form the catalogue is
 * missing. The click rate says whether the results are any good.
 */
type Report = {
  days: number
  since: string
  totals: { searches: number, terms: number, zero: number, zeroShare: number | null, clicks: number, clickRate: number | null, searchers: number }
  top: Array<{ term: string, searches: number, results: number | null, clicks: number, clickRate: number | null, lastAt: string }>
  zero: Array<{ term: string, searches: number, lastAt: string }>
  recent: Array<{
    id: string
    kind: 'SEARCH' | 'CLICK'
    term: string
    results: number | null
    position: number | null
    source: string
    createdAt: string
    product: { id: string, name: string, slug: string } | null
  }>
}

const { adminFetch } = useAdminApi()
const days = ref('30')
const report = ref<Report | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    report.value = await adminFetch<Report>('/search/report', { params: { days: days.value } })
  }
  catch {
    loadError.value = 'Не удалось загрузить журнал поиска'
  }
  finally {
    loading.value = false
  }
}
onMounted(load)
watch(days, load)

const dayOptions = [
  { value: '1', label: 'Сутки' },
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: '365', label: 'Год' },
]
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const catalogLink = (term: string) => `/catalog?search=${encodeURIComponent(term)}`

const topColumns = [
  { key: 'term', label: 'Запрос' },
  { key: 'searches', label: 'Поисков', align: 'end' as const, nowrap: true },
  { key: 'results', label: 'Нашлось', align: 'end' as const, nowrap: true },
  { key: 'clicks', label: 'Кликов', align: 'end' as const, nowrap: true },
  { key: 'clickRate', label: 'С кликом', align: 'end' as const, nowrap: true },
  { key: 'lastAt', label: 'Последний', align: 'end' as const, nowrap: true },
]
const zeroColumns = [
  { key: 'term', label: 'Запрос' },
  { key: 'searches', label: 'Раз', align: 'end' as const, nowrap: true },
  { key: 'lastAt', label: 'Последний', align: 'end' as const, nowrap: true },
]
const recentColumns = [
  { key: 'createdAt', label: 'Когда', width: '150px', nowrap: true },
  { key: 'term', label: 'Запрос' },
  { key: 'what', label: 'Что было' },
]
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="Поиск"
      description="Что ищут покупатели, что не находится и на что кликают"
    >
      <UiSelect v-model="days" :options="dayOptions" size="sm" aria-label="Период" />
    </AdminPageHead>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>
    <UiSkeleton v-if="loading && !report" height="420px" radius="var(--radius-md)" />

    <template v-else-if="report">
      <div class="stats">
        <UiStat label="Поисков" :value="report.totals.searches" :hint="`${report.totals.terms} разных запросов, ${report.totals.searchers} посетителей`" />
        <UiStat
          label="Ничего не найдено"
          :value="pct(report.totals.zeroShare)"
          :tone="(report.totals.zeroShare ?? 0) > 0.15 ? 'warning' : 'neutral'"
          :hint="`${report.totals.zero} поисков без результата`"
        />
        <UiStat
          label="Поисков с кликом"
          :value="pct(report.totals.clickRate)"
          :hint="`${report.totals.clicks} кликов по найденному`"
        />
      </div>

      <UiAlert v-if="!report.totals.searches" tone="info">
        За этот период поисков ещё не было. Журнал заполняется с 3 ноября 2026 — по мере того как покупатели ищут на сайте.
      </UiAlert>

      <div class="columns">
        <UiCard>
          <h2 class="section-title">Ничего не найдено</h2>
          <p class="admin-muted section-note">
            Каждая строка — товар, синоним или написание, которого каталогу не хватает. Самые частые сверху.
          </p>
          <UiTable :columns="zeroColumns" :rows="report.zero" row-key="term" empty-text="Пусто — всё находилось.">
            <template #cell-term="{ row }">
              <NuxtLink :to="catalogLink(row.term)" target="_blank">{{ row.term }}</NuxtLink>
            </template>
            <template #cell-lastAt="{ row }">{{ formatDateTime(row.lastAt) }}</template>
          </UiTable>
        </UiCard>

        <UiCard>
          <h2 class="section-title">Частые запросы</h2>
          <p class="admin-muted section-note">
            «С кликом» — какая часть поисков закончилась переходом в товар. Низкая при большом «Нашлось» — выдача не та.
          </p>
          <UiTable :columns="topColumns" :rows="report.top" row-key="term" empty-text="Поисков пока не было.">
            <template #cell-term="{ row }">
              <NuxtLink :to="catalogLink(row.term)" target="_blank">{{ row.term }}</NuxtLink>
            </template>
            <template #cell-results="{ row }">
              <span :class="{ zero: row.results === 0 }">{{ row.results ?? '—' }}</span>
            </template>
            <template #cell-clickRate="{ row }">{{ pct(row.clickRate) }}</template>
            <template #cell-lastAt="{ row }">{{ formatDateTime(row.lastAt) }}</template>
          </UiTable>
        </UiCard>
      </div>

      <UiCard>
        <h2 class="section-title">Последние события</h2>
        <UiTable :columns="recentColumns" :rows="report.recent" row-key="id" empty-text="Событий пока нет.">
          <template #cell-createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          <template #cell-term="{ row }">
            <code>{{ row.term }}</code>
            <span class="admin-muted"> · {{ row.source === 'suggest' ? 'подсказки' : 'каталог' }}</span>
          </template>
          <template #cell-what="{ row }">
            <template v-if="row.kind === 'SEARCH'">
              <span :class="{ zero: row.results === 0 }">нашлось {{ row.results ?? '—' }}</span>
            </template>
            <template v-else>
              клик №{{ row.position }}:
              <NuxtLink v-if="row.product" :to="`/product/${row.product.slug}`" target="_blank">{{ row.product.name }}</NuxtLink>
              <span v-else class="admin-muted">товар удалён</span>
            </template>
          </template>
        </UiTable>
      </UiCard>
    </template>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-3);
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  gap: var(--space-4);
  align-items: start;
}

.section-title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-lg);
}

.section-note {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
}

.zero {
  color: var(--danger);
  font-weight: 700;
}

@media (max-width: 1024px) {
  .columns {
    grid-template-columns: 1fr;
  }
}
</style>
