<script setup lang="ts">
import type { MetrikaReport, MetrikaStatus, TrafficDevice, TrafficReport } from '~/types/api'
import {
  DEVICE_LABELS,
  formatChange,
  formatCount,
  monthLabel,
  monthTitle,
  share,
} from '~/utils/traffic-format'

definePageMeta({ layout: 'admin' })

/**
 * The site's own traffic statistics (backend `traffic/`): visits by month
 * and day, phones against computers, where visits come from, and every
 * «Страница не найдена» with the page that linked to it.
 */
const { adminFetch, errorMessage } = useAdminApi()
const own = ref<TrafficReport | null>(null)
const metrika = ref<MetrikaReport | null>(null)
const metrikaStatus = ref<MetrikaStatus | null>(null)
const loading = ref(true)
const loadError = ref('')

/**
 * Two sources, one screen: Yandex Metrika (has the history, the numbers the
 * owner already knows) and our own counter (since 2026-11-05, every 404 with
 * its exact referrer). Metrika is the default once it is connected.
 */
const source = ref<'metrika' | 'own'>('own')
const sourceTabs = [
  { value: 'metrika', label: 'Яндекс.Метрика' },
  { value: 'own', label: 'Наш счётчик' },
]
let sourceChosen = false

async function loadMetrika(refresh = false) {
  metrikaStatus.value = await adminFetch<MetrikaStatus>('/traffic/metrika/status').catch(() => null)
  if (!metrikaStatus.value?.configured) {
    metrika.value = null
    return
  }
  metrika.value = await adminFetch<MetrikaReport>('/traffic/metrika', { params: refresh ? { refresh: 1 } : {} })
    .catch(error => ({ configured: true, source: 'metrika', counterId: '', error: errorMessage(error, 'Метрика не ответила') }) as MetrikaReport)
}

async function load(refresh = false) {
  loading.value = true
  loadError.value = ''
  try {
    const [ownReport] = await Promise.all([
      adminFetch<TrafficReport>('/traffic/report'),
      loadMetrika(refresh),
    ])
    own.value = ownReport
    if (!sourceChosen && metrikaStatus.value?.configured && !metrikaStatus.value.error) source.value = 'metrika'
  }
  catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить статистику')
  }
  finally {
    loading.value = false
  }
}
onMounted(() => load())
watch(source, () => { sourceChosen = true })

const metrikaError = computed(() => (metrika.value && 'error' in metrika.value ? metrika.value.error : ''))
const metrikaWarnings = computed(() => (metrika.value && 'warnings' in metrika.value ? metrika.value.warnings : []))
/** What the screen draws: the chosen source, when it has a report. */
const report = computed<TrafficReport | null>(() => {
  if (source.value === 'own') return own.value
  const m = metrika.value
  return m && 'summary' in m ? m : null
})

const tokenInput = ref('')
const savingToken = ref(false)
const tokenError = ref('')
async function saveToken() {
  savingToken.value = true
  tokenError.value = ''
  try {
    metrikaStatus.value = await adminFetch<MetrikaStatus>('/traffic/metrika/token', { method: 'PUT', body: { token: tokenInput.value } })
    tokenInput.value = ''
    source.value = 'metrika'
    await loadMetrika(true)
  }
  catch (error) {
    tokenError.value = errorMessage(error, 'Не удалось сохранить токен')
  }
  finally {
    savingToken.value = false
  }
}
const confirmDisconnect = ref(false)
async function disconnect() {
  metrikaStatus.value = await adminFetch<MetrikaStatus>('/traffic/metrika/token', { method: 'DELETE' }).catch(() => metrikaStatus.value)
  metrika.value = null
  confirmDisconnect.value = false
  source.value = 'own'
}

const summary = computed(() => report.value?.summary)
const currentMonth = computed(() => report.value?.days.current.month ?? '')
const previousMonth = computed(() => report.value?.days.previous.month ?? '')

const changeTone = (value: number | null | undefined) =>
  value === null || value === undefined ? 'neutral' : value >= 0 ? 'success' : 'warning'

const DEVICES: TrafficDevice[] = ['mobile', 'desktop', 'tablet']
const devices30 = computed(() => {
  const totals = summary.value?.last30
  if (!totals) return []
  return DEVICES.map(key => ({
    key,
    label: DEVICE_LABELS[key],
    visits: totals.devices[key],
    share: share(totals.devices[key], totals.visits),
  }))
})

/** Newest month first in the table; the chart reads oldest → newest. */
const monthRows = computed(() => [...(report.value?.months ?? [])].reverse().map((m, i, rows) => {
  const prev = rows[i + 1]
  return {
    ...m,
    change: prev?.visits ? (m.visits - prev.visits) / prev.visits : null,
  }
}))

const monthColumns = [
  { key: 'month', label: 'Месяц', nowrap: true },
  { key: 'visits', label: 'Визиты', align: 'end' as const, nowrap: true },
  { key: 'change', label: 'К прошлому', align: 'end' as const, nowrap: true },
  { key: 'visitors', label: 'Посетители', align: 'end' as const, nowrap: true },
  { key: 'views', label: 'Просмотры', align: 'end' as const, nowrap: true },
  { key: 'mobile', label: 'Телефоны', align: 'end' as const, nowrap: true },
  { key: 'desktop', label: 'Компьютеры', align: 'end' as const, nowrap: true },
  { key: 'tablet', label: 'Планшеты', align: 'end' as const, nowrap: true },
  { key: 'notFound', label: '404', align: 'end' as const, nowrap: true },
]
const notFoundColumns = [
  { key: 'path', label: 'Адрес, который хотели' },
  { key: 'referrer', label: 'Откуда пришли (последний раз)' },
  { key: 'views', label: 'Раз', align: 'end' as const, nowrap: true },
  { key: 'lastAt', label: 'Последний', align: 'end' as const, nowrap: true },
]
const recentColumns = [
  { key: 'createdAt', label: 'Когда', width: '150px', nowrap: true },
  { key: 'path', label: 'Адрес' },
  { key: 'referrer', label: 'Откуда' },
  { key: 'device', label: 'Устройство', nowrap: true },
]
const sourceColumns = [
  { key: 'source', label: 'Источник' },
  { key: 'visits', label: 'Визиты', align: 'end' as const, nowrap: true },
]
const landingColumns = [
  { key: 'path', label: 'Страница входа' },
  { key: 'visits', label: 'Визиты', align: 'end' as const, nowrap: true },
]

/** «откуда»: our own page as a path, someone else's as host + path. */
function referrerLabel(referrer: string | null): string {
  if (!referrer) return 'прямой заход / закладка'
  try {
    const url = new URL(referrer)
    if (url.host === window.location.host) return `наш сайт: ${url.pathname}`
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  }
  catch {
    return referrer
  }
}
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="Посещаемость"
      description="Визиты, телефоны и компьютеры, динамика по месяцам и страницы «не найдено»"
    >
      <UiButton variant="secondary" size="sm" :loading="loading" @click="load(true)">Обновить</UiButton>
    </AdminPageHead>

    <UiTabs v-model="source" :tabs="sourceTabs" />

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <template v-if="source === 'metrika' && !loading">
      <UiCard v-if="!metrikaStatus?.configured" title="Подключить Яндекс.Метрику">
        <p class="note-top">
          Нужен OAuth-токен аккаунта, у которого есть доступ к счётчику {{ metrikaStatus?.counterId ?? '113800110' }}.
          Токен только читает статистику.
        </p>
        <ol class="steps">
          <li>Откройте <a href="https://oauth.yandex.ru/client/new" target="_blank" rel="noopener">oauth.yandex.ru/client/new</a>, платформа «Веб-сервисы», Redirect URI <code>https://oauth.yandex.ru/verification_code</code>.</li>
          <li>В доступах отметьте «Яндекс.Метрика → Получение статистики, чтение параметров своих и доверенных счётчиков».</li>
          <li>Откройте <code>https://oauth.yandex.ru/authorize?response_type=token&amp;client_id=&lt;ClientID&gt;</code> и скопируйте токен.</li>
        </ol>
        <form class="token-form" @submit.prevent="saveToken">
          <UiInput v-model="tokenInput" type="password" placeholder="y0_…" autocomplete="off" />
          <UiButton type="submit" :loading="savingToken" :disabled="!tokenInput.trim()">Подключить</UiButton>
        </form>
        <UiAlert v-if="tokenError" tone="danger">{{ tokenError }}</UiAlert>
      </UiCard>
      <template v-else>
        <p class="admin-muted connection">
          Счётчик {{ metrikaStatus.counterId }}<template v-if="metrikaStatus.counterName"> «{{ metrikaStatus.counterName }}»</template>,
          токен {{ metrikaStatus.tokenHint }} ·
          <UiButton variant="link" size="sm" @click="confirmDisconnect = true">Отключить</UiButton>
        </p>
        <UiAlert v-if="metrikaStatus.error || metrikaError" tone="danger">
          Метрика не отдала данные: {{ metrikaStatus.error || metrikaError }}
        </UiAlert>
        <UiAlert v-for="w in metrikaWarnings" :key="w" tone="warning">Не загрузилось — {{ w }}</UiAlert>
      </template>
    </template>

    <UiConfirm
      v-model:open="confirmDisconnect"
      title="Отключить Метрику?"
      confirm-label="Отключить"
      @confirm="disconnect"
    >
      Токен будет удалён с сайта. Подключить снова можно в любой момент.
    </UiConfirm>

    <UiSkeleton v-if="loading && !report" height="480px" radius="var(--radius-md)" />

    <template v-else-if="report && summary">
      <UiAlert v-if="source === 'own' && !summary.last30.views" tone="info">
        Статистика собирается с 5 ноября 2026: каждый показ страницы реальному посетителю (роботы и
        админы не считаются). Графики заполнятся по мере визитов.
      </UiAlert>

      <section class="stats" :class="{ refreshing: loading }">
        <UiStat
          :label="`Визиты, ${monthLabel(currentMonth)} (1–${summary.day})`"
          :value="formatCount(summary.current.visits)"
          :tone="changeTone(summary.change.visits)"
          :hint="`${formatChange(summary.change.visits)} к 1–${summary.day} ${monthLabel(previousMonth)} (${formatCount(summary.previousToDate.visits)})`"
        />
        <UiStat
          :label="`Посетители, ${monthLabel(currentMonth)}`"
          :value="formatCount(summary.current.visitors)"
          :tone="changeTone(summary.change.visitors)"
          :hint="`${formatChange(summary.change.visitors)} к тому же периоду ${monthLabel(previousMonth)}`"
        />
        <UiStat
          :label="`Весь ${monthTitle(previousMonth)}`"
          :value="formatCount(summary.previousMonth.visits)"
          :hint="`визитов · ${formatCount(summary.previousMonth.visitors)} посетителей · ${formatCount(summary.previousMonth.views)} просмотров`"
        />
        <UiStat
          label="Страница не найдена, 30 дней"
          :value="formatCount(summary.last30.notFound)"
          :tone="summary.last30.notFound ? 'warning' : 'success'"
          :hint="summary.last30.views ? `${share(summary.last30.notFound, summary.last30.views)} просмотров` : 'пока нет данных'"
        />
      </section>

      <div class="columns">
        <UiCard title="Визиты по месяцам за год">
          <AdminTrafficMonthsChart :months="report.months" />
        </UiCard>
        <UiCard title="Устройства, 30 дней">
          <ul class="devices">
            <li v-for="d in devices30" :key="d.key">
              <span class="device-name">{{ d.label }}</span>
              <strong>{{ d.share }}</strong>
              <span class="admin-muted">{{ formatCount(d.visits) }} визитов</span>
            </li>
          </ul>
          <p class="admin-muted note">
            Доля визитов. Устройство определяется по браузеру; iPad, который
            представляется Mac, считается планшетом.
          </p>
        </UiCard>
      </div>

      <UiCard :title="`По дням: ${monthTitle(currentMonth)} против ${monthTitle(previousMonth)}`">
        <AdminTrafficDaysChart :current="report.days.current" :previous="report.days.previous" />
      </UiCard>

      <UiCard title="По месяцам — таблица">
        <UiTable :columns="monthColumns" :rows="monthRows" row-key="month" empty-text="Данных пока нет.">
          <template #cell-month="{ row }">{{ monthTitle(row.month) }}</template>
          <template #cell-visits="{ row }"><strong>{{ formatCount(row.visits) }}</strong></template>
          <template #cell-change="{ row }">
            <span :class="{ up: (row.change ?? 0) > 0, down: (row.change ?? 0) < 0 }">{{ formatChange(row.change) }}</span>
          </template>
          <template #cell-visitors="{ row }">{{ formatCount(row.visitors) }}</template>
          <template #cell-views="{ row }">{{ formatCount(row.views) }}</template>
          <template #cell-mobile="{ row }">{{ formatCount(row.devices.mobile) }}</template>
          <template #cell-desktop="{ row }">{{ formatCount(row.devices.desktop) }}</template>
          <template #cell-tablet="{ row }">{{ formatCount(row.devices.tablet) }}</template>
          <template #cell-notFound="{ row }">{{ formatCount(row.notFound) }}</template>
        </UiTable>
      </UiCard>

      <UiCard title="Страница не найдена — что искали, 30 дней">
        <p class="admin-muted note">
          <template v-if="source === 'metrika'">По Метрике — просмотры страниц с заголовком «Страница не найдена», реферер — самый частый. </template>
          Адрес, на который пришли, и страница со ссылкой. Ссылка с нашего сайта — ошибка у нас;
          с поисковика или чужого сайта — старый адрес, его можно перенаправить.
        </p>
        <UiTable :columns="notFoundColumns" :rows="report.notFound" row-key="path" empty-text="Ни одной «не найдено» — хорошо.">
          <template #cell-path="{ row }"><code>{{ row.path }}</code></template>
          <template #cell-referrer="{ row }">
            <a v-if="row.referrer" :href="row.referrer" target="_blank" rel="noopener noreferrer nofollow">{{ referrerLabel(row.referrer) }}</a>
            <span v-else class="admin-muted">{{ referrerLabel(null) }}</span>
          </template>
          <template #cell-views="{ row }">{{ formatCount(row.views) }}</template>
          <template #cell-lastAt="{ row }">{{ row.lastAt ? formatDateTime(row.lastAt) : '—' }}</template>
        </UiTable>
      </UiCard>

      <div class="columns even">
        <UiCard title="Источники визитов, 30 дней">
          <UiTable :columns="sourceColumns" :rows="report.sources" row-key="source" empty-text="Визитов пока нет.">
            <template #cell-visits="{ row }">{{ formatCount(row.visits) }}</template>
          </UiTable>
        </UiCard>
        <UiCard title="Страницы входа, 30 дней">
          <UiTable :columns="landingColumns" :rows="report.landings" row-key="path" empty-text="Визитов пока нет.">
            <template #cell-path="{ row }">
              <NuxtLink :to="row.path" target="_blank">{{ row.path }}</NuxtLink>
            </template>
            <template #cell-visits="{ row }">{{ formatCount(row.visits) }}</template>
          </UiTable>
        </UiCard>
      </div>

      <UiCard v-if="source === 'own'" title="Последние «не найдено»">
        <UiTable :columns="recentColumns" :rows="report.recentNotFound" row-key="id" empty-text="Пока не было.">
          <template #cell-createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          <template #cell-path="{ row }"><code>{{ row.path }}</code></template>
          <template #cell-referrer="{ row }">{{ referrerLabel(row.referrer) }}</template>
          <template #cell-device="{ row }">{{ DEVICE_LABELS[row.device] ?? row.device }}</template>
        </UiTable>
      </UiCard>
    </template>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--space-3);
  transition: opacity var(--duration-fast) var(--ease-out);
}

.refreshing {
  opacity: 0.6;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}

.columns.even {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.devices {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.devices li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0 var(--space-2);
}

.devices strong {
  color: var(--text-strong);
  font-size: var(--text-xl);
  font-variant-numeric: tabular-nums;
}

.devices .admin-muted {
  grid-column: 1 / -1;
  font-size: var(--text-sm);
}

.device-name {
  font-weight: 600;
}

.note-top {
  margin: 0 0 var(--space-3);
}

.steps {
  margin: 0 0 var(--space-4);
  padding-left: var(--space-5);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.token-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  max-width: 560px;
  margin-bottom: var(--space-3);
}

.token-form > :first-child {
  flex: 1 1 260px;
}

.connection {
  margin: 0;
  font-size: var(--text-sm);
}

.note {
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
}

.up {
  color: var(--success);
  font-weight: 700;
}

.down {
  color: var(--danger);
  font-weight: 700;
}

code {
  word-break: break-all;
}

@media (max-width: 1024px) {
  .columns,
  .columns.even {
    grid-template-columns: 1fr;
  }
}
</style>
