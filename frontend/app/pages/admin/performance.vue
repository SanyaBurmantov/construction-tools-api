<script setup lang="ts">
import { formatDateTimeWithSeconds as formatDateTime } from '~/utils/format-datetime'

definePageMeta({ layout: 'admin' })

/**
 * «Скорость»: where the time goes (backend `perf/`).
 * - API by route — measured in the API process since its last start (a
 *   deploy resets it): count, average, p95, the slowest, recent slow ones.
 * - Database — pg_stat_statements: which SQL costs the server most in total,
 *   which is slow per call; plus cache hit ratio, connections, statements
 *   running right now, tables read by full scans.
 * The same numbers drive the «🐢 Сайт отвечает медленно» Telegram alert.
 */
type RouteRow = {
  route: string
  count: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  errors: number
  slow: number
  totalMs: number
}
type SlowRequest = { at: string, method: string, route: string, url: string, status: number, ms: number }
type Requests = { since: string, slowThresholdMs: number, routes: RouteRow[], slow: SlowRequest[] }
type Statement = {
  queryid: string
  calls: number
  totalMs: number
  meanMs: number
  maxMs: number
  rows: number
  hitRatio: number | null
  share: number | null
  query: string
}
type Database = {
  statements: Statement[]
  statementsError: string | null
  statementsSince: string | null
  overview: { size: string, hitRatio: number | null, commits: number, rollbacks: number, deadlocks: number, tempBytes: string } | null
  connections: Array<{ state: string, count: number }>
  tables: Array<{ table: string, rows: number, seqScan: number, seqTupRead: number, idxScan: number | null, dead: number, size: string, lastVacuum: string | null }>
  running: Array<{ pid: number, seconds: number, state: string, query: string }>
}

const { adminFetch } = useAdminApi()
const { run, busy } = useAdminAction()

const requests = ref<Requests | null>(null)
const db = ref<Database | null>(null)
const loading = ref(true)
const loadError = ref('')
const sort = ref<'total' | 'mean' | 'calls'>('total')
const expanded = ref('')
const confirmReset = ref<'' | 'api' | 'db'>('')

async function load() {
  loadError.value = ''
  try {
    const [r, d] = await Promise.all([
      adminFetch<Requests>('/perf/requests'),
      adminFetch<Database>('/perf/db', { params: { sort: sort.value } }),
    ])
    requests.value = r
    db.value = d
  }
  catch {
    loadError.value = 'Не удалось загрузить показатели'
  }
  finally {
    loading.value = false
  }
}
onMounted(load)
watch(sort, load)

// Live while the page is open and visible: «что сейчас выполняется» is only
// useful fresh.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void load()
  }, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))

async function reset() {
  const which = confirmReset.value
  const result = await run(
    () => adminFetch<unknown>(which === 'api' ? '/perf/requests/reset' : '/perf/db/reset', { method: 'POST' }),
    { key: 'reset', error: 'Не удалось сбросить', success: 'Статистика начата заново' }
  )
  confirmReset.value = ''
  if (result) await load()
}

const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} с` : `${Math.round(value)} мс`)
const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(value > 0.995 ? 2 : 1)}%`)
const num = (value: number) => value.toLocaleString('ru-RU')
const tone = (value: number) => (value >= 3000 ? 'bad' : value >= 1000 ? 'warn' : '')

const slowRoutes = computed(() => (requests.value?.routes ?? []).filter(row => row.p95Ms >= 1000).length)
const connectionsTotal = computed(() => (db.value?.connections ?? []).reduce((sum, row) => sum + row.count, 0))
const activeConnections = computed(() => db.value?.connections.find(row => row.state === 'active')?.count ?? 0)

const routeColumns = [
  { key: 'route', label: 'Маршрут' },
  { key: 'count', label: 'Запросов', align: 'end' as const, nowrap: true },
  { key: 'avgMs', label: 'Среднее', align: 'end' as const, nowrap: true },
  { key: 'p95Ms', label: '95%', align: 'end' as const, nowrap: true },
  { key: 'maxMs', label: 'Макс.', align: 'end' as const, nowrap: true },
  { key: 'slow', label: 'Медленных', align: 'end' as const, nowrap: true },
  { key: 'errors', label: '5xx', align: 'end' as const, nowrap: true },
]
const slowColumns = [
  { key: 'at', label: 'Когда', width: '150px', nowrap: true },
  { key: 'url', label: 'Запрос' },
  { key: 'status', label: 'Код', align: 'end' as const, width: '60px' },
  { key: 'ms', label: 'Время', align: 'end' as const, width: '80px', nowrap: true },
]
const tableColumns = [
  { key: 'table', label: 'Таблица' },
  { key: 'rows', label: 'Строк', align: 'end' as const, nowrap: true },
  { key: 'size', label: 'Размер', align: 'end' as const, nowrap: true },
  { key: 'seqScan', label: 'Полных проходов', align: 'end' as const, nowrap: true },
  { key: 'seqTupRead', label: 'Строк прочитано так', align: 'end' as const, nowrap: true },
  { key: 'idxScan', label: 'По индексу', align: 'end' as const, nowrap: true },
  { key: 'dead', label: 'Мёртвых строк', align: 'end' as const, nowrap: true },
]
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="Скорость"
      description="Сколько отвечает сайт и что нагружает базу. Обновляется каждые 30 секунд, пока страница открыта"
    >
      <UiButton variant="secondary" size="sm" :loading="loading" @click="load">Обновить</UiButton>
    </AdminPageHead>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>
    <UiSkeleton v-if="loading && !requests" height="420px" radius="var(--radius-md)" />

    <template v-else-if="requests && db">
      <div class="stats">
        <UiStat
          label="Маршрутов с 95% дольше 1 с"
          :value="slowRoutes"
          :tone="slowRoutes ? 'warning' : 'success'"
          :hint="`API с ${formatDateTime(requests.since)}`"
        />
        <UiStat
          label="Попадание в кэш базы"
          :value="pct(db.overview?.hitRatio ?? null)"
          :tone="(db.overview?.hitRatio ?? 1) < 0.95 ? 'warning' : 'success'"
          hint="Ниже 95% — данным не хватает памяти"
        />
        <UiStat
          label="Соединений с базой"
          :value="`${activeConnections} / ${connectionsTotal}`"
          hint="Активных / всего"
        />
        <UiStat label="Размер базы" :value="db.overview?.size ?? '—'" :hint="`Временные файлы: ${db.overview?.tempBytes ?? '—'}`" />
      </div>

      <!-- Running now -->
      <UiCard v-if="db.running.length">
        <h2 class="section-title">Выполняется в базе прямо сейчас (дольше 1 с)</h2>
        <ul class="running">
          <li v-for="row in db.running" :key="row.pid">
            <span class="time" :class="tone(row.seconds * 1000)">{{ ms(row.seconds * 1000) }}</span>
            <code>{{ row.query }}</code>
          </li>
        </ul>
      </UiCard>

      <!-- API -->
      <UiCard>
        <div class="section-head">
          <h2 class="section-title">API по маршрутам</h2>
          <UiButton variant="ghost" size="sm" @click="confirmReset = 'api'">Сбросить</UiButton>
        </div>
        <p class="admin-muted section-note">
          С {{ formatDateTime(requests.since) }} (перезапуск API или сброс). «Медленные» — дольше {{ ms(requests.slowThresholdMs) }}.
          Сверху — что отняло больше всего времени в сумме.
        </p>
        <UiTable :columns="routeColumns" :rows="requests.routes.slice(0, 40)" row-key="route" empty-text="Запросов ещё не было.">
          <template #cell-route="{ row }"><code class="route">{{ row.route }}</code></template>
          <template #cell-count="{ row }">{{ num(row.count) }}</template>
          <template #cell-avgMs="{ row }"><span :class="tone(row.avgMs)">{{ ms(row.avgMs) }}</span></template>
          <template #cell-p95Ms="{ row }"><span :class="tone(row.p95Ms)">{{ ms(row.p95Ms) }}</span></template>
          <template #cell-maxMs="{ row }"><span :class="tone(row.maxMs)">{{ ms(row.maxMs) }}</span></template>
          <template #cell-slow="{ row }">{{ row.slow || '' }}</template>
          <template #cell-errors="{ row }"><span :class="{ bad: row.errors }">{{ row.errors || '' }}</span></template>
        </UiTable>
      </UiCard>

      <UiCard v-if="requests.slow.length">
        <h2 class="section-title">Последние медленные запросы</h2>
        <UiTable :columns="slowColumns" :rows="requests.slow.slice(0, 30)" empty-text="">
          <template #cell-at="{ row }">{{ formatDateTime(row.at) }}</template>
          <template #cell-url="{ row }"><code class="route">{{ row.method }} {{ row.url }}</code></template>
          <template #cell-ms="{ row }"><span :class="tone(row.ms)">{{ ms(row.ms) }}</span></template>
        </UiTable>
      </UiCard>

      <!-- Database statements -->
      <UiCard>
        <div class="section-head">
          <h2 class="section-title">Запросы к базе</h2>
          <UiButton variant="ghost" size="sm" @click="confirmReset = 'db'">Сбросить</UiButton>
        </div>
        <UiAlert v-if="db.statementsError" tone="warning">
          Статистика запросов недоступна: {{ db.statementsError }}. Расширение pg_stat_statements включается при выкатке — после перезапуска базы появится.
        </UiAlert>
        <template v-else>
          <p class="admin-muted section-note">
            pg_stat_statements{{ db.statementsSince ? ` с ${formatDateTime(db.statementsSince)}` : '' }}.
            «Доля» — часть всего времени базы. Нажмите на запрос, чтобы увидеть целиком.
          </p>
          <UiTabs
            v-model="sort"
            :tabs="[
              { value: 'total', label: 'Больше всего времени' },
              { value: 'mean', label: 'Самые медленные' },
              { value: 'calls', label: 'Самые частые' }
            ]"
          />
          <ol class="statements">
            <li v-for="row in db.statements" :key="row.queryid" class="statement" @click="expanded = expanded === row.queryid ? '' : row.queryid">
              <div class="statement-figures">
                <span class="share">{{ pct(row.share) }}</span>
                <span>{{ num(row.calls) }} выз.</span>
                <span :class="tone(row.meanMs)">в среднем {{ ms(row.meanMs) }}</span>
                <span :class="tone(row.maxMs)">макс. {{ ms(row.maxMs) }}</span>
                <span>всего {{ ms(row.totalMs) }}</span>
                <span class="admin-muted">кэш {{ pct(row.hitRatio) }}</span>
              </div>
              <code class="sql" :class="{ open: expanded === row.queryid }">{{ row.query }}</code>
            </li>
          </ol>
        </template>
      </UiCard>

      <!-- Tables -->
      <UiCard>
        <h2 class="section-title">Таблицы, которые читаются целиком</h2>
        <p class="admin-muted section-note">
          Много строк, прочитанных полным проходом, — кандидат на индекс. Много «мёртвых строк» — давно не было очистки (VACUUM).
        </p>
        <UiTable :columns="tableColumns" :rows="db.tables" row-key="table">
          <template #cell-table="{ row }"><code>{{ row.table }}</code></template>
          <template #cell-rows="{ row }">{{ num(row.rows) }}</template>
          <template #cell-seqScan="{ row }">{{ num(row.seqScan) }}</template>
          <template #cell-seqTupRead="{ row }">{{ num(row.seqTupRead) }}</template>
          <template #cell-idxScan="{ row }">{{ row.idxScan === null ? '—' : num(row.idxScan) }}</template>
          <template #cell-dead="{ row }"><span :class="{ warn: row.dead > row.rows * 0.2 && row.dead > 1000 }">{{ num(row.dead) }}</span></template>
        </UiTable>
      </UiCard>
    </template>

    <UiConfirm
      :open="Boolean(confirmReset)"
      :title="confirmReset === 'api' ? 'Сбросить статистику API?' : 'Сбросить статистику запросов к базе?'"
      confirm-label="Сбросить"
      tone="primary"
      :busy="busy === 'reset'"
      @update:open="(value: boolean) => { if (!value) confirmReset = '' }"
      @confirm="reset"
    >
      Счёт начнётся с нуля. Удобно после оптимизации — чтобы увидеть, как стало, без старых цифр.
    </UiConfirm>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-3);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.section-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-lg);
}

.section-note {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
}

.route {
  font-size: var(--text-sm);
  word-break: break-all;
}

.warn {
  color: var(--warning-soft-text);
  font-weight: 600;
}

.bad {
  color: var(--danger);
  font-weight: 700;
}

.running {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.running li {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
}

.running code {
  overflow: hidden;
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  flex: none;
  min-width: 56px;
  font-weight: 700;
  text-align: right;
}

.statements {
  display: grid;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}

.statement {
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.statement:hover {
  background: var(--surface-hover);
}

.statement-figures {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin-bottom: var(--space-2);
  font-size: var(--text-sm);
}

.share {
  min-width: 52px;
  color: var(--brand);
  font-weight: 800;
}

.sql {
  display: -webkit-box;
  overflow: hidden;
  font-size: var(--text-xs);
  white-space: pre-wrap;
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.sql.open {
  display: block;
}
</style>
