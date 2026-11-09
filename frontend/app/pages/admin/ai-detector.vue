<script setup lang="ts">
import { formatDateTime } from '~/utils/format-datetime'

definePageMeta({ layout: 'admin' })

/**
 * «ИИ-детектор» (backend `ai-detector/` + the `detector` container): paste a
 * text or give a page address, get the probability that a language model
 * wrote it, which parts look generated and which stock phrases to rewrite.
 * Every check is kept, so a text can be compared before and after an edit.
 * Open to the SEO role.
 */
type Verdict = { key: string, label: string }
type Report = {
  probability: number
  verdict: Verdict
  model: string
  tokens: number
  words: number
  warnings: string[]
  picked?: string | null
  ms?: number
  fragments: Array<{ start: number, end: number, words: number, probability: number, verdict: Verdict }>
  markers: Array<{ kind: string, label: string, start: number, end: number, text: string }>
  markerSummary: Array<{ kind: string, label: string, count: number, per100Words: number, examples: string[] }>
  rhythm: { words: number, sentences: number, avgSentenceWords: number, burstiness: number | null, lexicalVariety: number | null }
  uniqueness?: Uniqueness | null
}
type UniquenessMatch = {
  kind: 'supplier' | 'sibling' | 'catalogue' | 'competitor' | 'page'
  title: string
  url: string | null
  supplier?: string
  share: number
}
/** Offsets here are JavaScript string indices, unlike the detector's code points. */
type Uniqueness = {
  percent: number | null
  contentWords: number
  matches: UniquenessMatch[]
  spans: Array<{ start: number, end: number, sources: number[] }>
  scope: string[]
  warnings: string[]
}
type Check = {
  id: string
  createdAt: string
  createdBy: string | null
  source: 'text' | 'url'
  url: string | null
  title: string | null
  text: string
  probability: number
  verdict: string
  words: number
  model: string
  report: Report
}
type CheckRow = Omit<Check, 'text' | 'report'>
type Status = { configured: boolean, ok: boolean, model?: string, error?: string }

const { adminFetch, isSeo } = useAdminApi()
const { run, busy } = useAdminAction()

const status = ref<Status | null>(null)
const mode = ref<'text' | 'url'>('text')
const text = ref('')
const url = ref('')
const compareUrls = ref('')
const productName = ref('')
/** The competitors' site searches, one `name address-with-{q}` per line. */
const competitorsText = ref('')
const competitorsDefaults = ref('')
const result = ref<Check | null>(null)
const highlight = ref<'ai' | 'copy'>('ai')

const modeTabs = [
  { value: 'text', label: 'Текст' },
  { value: 'url', label: 'Страница по адресу' },
]

const history = ref<CheckRow[]>([])
const historyTotal = ref(0)
const historyPage = ref(1)
const historyLimit = 20
const historyLoading = ref(false)

async function loadCompetitors() {
  const settings = await adminFetch<{ text: string, defaults: string }>('/ai-detector/competitors').catch(() => null)
  if (settings) {
    competitorsText.value = settings.text
    competitorsDefaults.value = settings.defaults
  }
}

async function saveCompetitors() {
  const saved = await run(
    () => adminFetch<{ text: string, defaults: string }>('/ai-detector/competitors', {
      method: 'PUT',
      body: { text: competitorsText.value },
    }),
    { success: 'Список конкурентов сохранён', error: 'Не сохранилось', key: 'competitors' },
  )
  if (saved) competitorsText.value = saved.text
}

async function loadStatus() {
  status.value = await adminFetch<Status>('/ai-detector/status').catch(() => null)
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const page = await adminFetch<{ items: CheckRow[], total: number }>('/ai-detector/checks', {
      params: { page: historyPage.value, limit: historyLimit },
    })
    history.value = page.items
    historyTotal.value = page.total
  }
  catch {
    history.value = []
  }
  finally {
    historyLoading.value = false
  }
}

onMounted(() => {
  loadStatus()
  loadHistory()
  loadCompetitors()
})

const canCheck = computed(() =>
  mode.value === 'text' ? text.value.trim().length >= 20 : /^https?:\/\/\S+$/i.test(url.value.trim()),
)

async function check() {
  const compare = compareUrls.value.split(/\s+/).map(u => u.trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, 5)
  const body = {
    ...(mode.value === 'text' ? { text: text.value } : { url: url.value.trim() }),
    ...(compare.length ? { compareUrls: compare } : {}),
    ...(productName.value.trim() ? { productName: productName.value.trim() } : {}),
  }
  const checked = await run(
    () => adminFetch<Check>('/ai-detector/check', { method: 'POST', body }),
    { error: 'Проверка не удалась', key: 'check' },
  )
  if (checked) {
    result.value = checked
    highlight.value = 'ai'
    historyPage.value = 1
    loadHistory()
  }
}

async function open(id: string) {
  const check = await run(() => adminFetch<Check>(`/ai-detector/checks/${id}`), {
    error: 'Не удалось открыть проверку',
    key: `open-${id}`,
  })
  if (check) {
    result.value = check
    if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

/** Puts the checked text into the form to edit it and check again. */
function editAgain() {
  if (!result.value) return
  text.value = result.value.text
  mode.value = 'text'
}

async function remove(id: string) {
  await run(() => adminFetch(`/ai-detector/checks/${id}`, { method: 'DELETE' }), {
    error: 'Не удалось удалить',
    success: 'Удалено',
    key: `del-${id}`,
    after: () => {
      if (result.value?.id === id) result.value = null
      return loadHistory()
    },
  })
}

/* ---- Presentation ------------------------------------------------------- */

const pct = (p: number) => `${Math.round(p * 100)}%`

function tone(key: string): 'danger' | 'warning' | 'neutral' | 'success' {
  if (key === 'ai') return 'danger'
  if (key === 'likely-ai') return 'warning'
  if (key === 'human' || key === 'likely-human') return 'success'
  return 'neutral'
}

const VERDICT_LABELS: Record<string, string> = {
  'ai': 'нейросеть',
  'likely-ai': 'скорее нейросеть',
  'unclear': 'не понять',
  'likely-human': 'скорее человек',
  'human': 'человек',
}

/**
 * The detector counts offsets in Unicode code points (Python); JavaScript
 * strings index UTF-16 units. They differ only past an emoji or another
 * astral character, so the map is built only when the text has one.
 */
function offsetMapper(source: string) {
  if (!/[\uD800-\uDFFF]/.test(source)) return (i: number) => i
  const map: number[] = []
  let unit = 0
  for (const ch of source) {
    map.push(unit)
    unit += ch.length
  }
  map.push(unit)
  return (i: number) => map[Math.min(i, map.length - 1)] ?? unit
}

type Segment = {
  text: string
  level: string | null
  marker: string | null
  fragment: number | null
  copy: number[] | null
}

/** The checked text cut at every fragment and marker boundary. */
const segments = computed<Segment[]>(() => {
  const check = result.value
  if (!check) return []
  const source = check.text
  const at = offsetMapper(source)
  const fragments = check.report.fragments.length
    ? check.report.fragments.map((f, i) => ({ start: at(f.start), end: at(f.end), key: f.verdict.key, i }))
    : [{ start: 0, end: source.length, key: check.report.verdict.key, i: -1 }]
  const markers = check.report.markers.map(m => ({ start: at(m.start), end: at(m.end), label: m.label }))
  const copies = check.report.uniqueness?.spans ?? []
  const cuts = new Set<number>([0, source.length])
  for (const c of copies) cuts.add(c.start).add(c.end)
  for (const f of fragments) cuts.add(f.start).add(f.end)
  for (const m of markers) cuts.add(m.start).add(m.end)
  const points = [...cuts].sort((a, b) => a - b)
  const out: Segment[] = []
  for (let k = 0; k < points.length - 1; k++) {
    const start = points[k]!
    const end = points[k + 1]!
    if (end <= start) continue
    const fragment = fragments.find(f => start >= f.start && end <= f.end)
    const marker = markers.find(m => start >= m.start && end <= m.end)
    const copy = copies.find(c => start >= c.start && end <= c.end)
    out.push({
      text: source.slice(start, end),
      level: fragment && (fragment.key === 'ai' || fragment.key === 'likely-ai') ? fragment.key : null,
      marker: marker?.label ?? null,
      fragment: fragment && fragment.i >= 0 ? fragment.i : null,
      copy: copy?.sources ?? null,
    })
  }
  return out
})

const uniq = computed(() => result.value?.report.uniqueness ?? null)

function uniqTone(percent: number | null): 'danger' | 'warning' | 'neutral' | 'success' {
  if (percent === null) return 'neutral'
  if (percent >= 80) return 'success'
  if (percent >= 50) return 'warning'
  return 'danger'
}

const MATCH_KINDS: Record<UniquenessMatch['kind'], string> = {
  supplier: 'текст поставщика',
  sibling: 'похожий товар',
  catalogue: 'наш каталог',
  competitor: 'у конкурента',
  page: 'страница',
}

const highlightTabs = [
  { value: 'ai', label: 'Похоже на ИИ' },
  { value: 'copy', label: 'Совпадения' },
]

function segClass(seg: Segment) {
  if (highlight.value === 'copy') return seg.copy ? ['is-copy'] : []
  return [seg.level ? `lvl-${seg.level}` : '', seg.marker ? 'has-marker' : '']
}

function segTitle(seg: Segment) {
  if (highlight.value === 'copy') {
    const matches = uniq.value?.matches ?? []
    return seg.copy?.map(i => matches[i]?.title).filter(Boolean).join(' · ') || undefined
  }
  return seg.marker
    ? `${seg.marker}${fragmentTitle(seg.fragment) ? ' · ' + fragmentTitle(seg.fragment) : ''}`
    : fragmentTitle(seg.fragment)
}

const fragmentTitle = (i: number | null) => {
  const f = i === null ? null : result.value?.report.fragments[i]
  return f ? `Фрагмент: ${pct(f.probability)} — ${f.verdict.label.toLowerCase()}` : undefined
}

const historyColumns = [
  { key: 'createdAt', label: 'Когда', width: '150px', nowrap: true },
  { key: 'what', label: 'Что проверяли' },
  { key: 'words', label: 'Слов', align: 'end' as const, nowrap: true },
  { key: 'probability', label: 'ИИ', align: 'end' as const, nowrap: true },
  { key: 'createdBy', label: 'Кто', nowrap: true },
  { key: 'actions', label: '', align: 'end' as const, nowrap: true },
]
const historyPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / historyLimit)))
function setHistoryPage(page: number) {
  historyPage.value = page
  loadHistory()
}
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="ИИ-детектор"
      description="Вероятность, что текст написала нейросеть: какие части похожи на сгенерированные и какие штампы переписать"
    />

    <UiAlert v-if="status && !status.ok" tone="warning">
      Детектор сейчас недоступен{{ status.error ? `: ${status.error}` : '' }}.
      <template v-if="!status.configured">
        На сервере нужно включить контейнер <code>detector</code> (профиль compose) и задать <code>DETECTOR_URL</code>.
      </template>
    </UiAlert>

    <UiCard>
      <UiTabs v-model="mode" :tabs="modeTabs" />
      <form class="check-form" @submit.prevent="check">
        <UiTextarea
          v-if="mode === 'text'"
          v-model="text"
          :rows="9"
          :maxlength="200000"
          placeholder="Вставьте описание товара, статью, текст категории… (от 20 символов; лучше от 50 слов)"
        />
        <UiInput
          v-else
          v-model="url"
          type="url"
          placeholder="https://… — страница сайта, свой или чужой"
          autocomplete="off"
        />
        <UiInput
          v-model="productName"
          autocomplete="off"
          :placeholder="mode === 'text'
            ? 'Название товара — найти его у конкурентов (например, WORTEX CRH 1810)'
            : 'Название товара для поиска у конкурентов — нашу карточку можно не подписывать'"
        />
        <details class="compare" :open="!!compareUrls">
          <summary>Сравнить со страницами конкурентов или поставщика</summary>
          <UiTextarea
            v-model="compareUrls"
            :rows="3"
            placeholder="До 5 адресов, по одному в строке — уникальность посчитается и против них"
          />
        </details>
        <div class="check-actions">
          <UiButton type="submit" :loading="busy === 'check'" :disabled="!canCheck">Проверить</UiButton>
          <span class="admin-muted hint">
            <template v-if="mode === 'text'">{{ text.trim().length.toLocaleString('ru-RU') }} символов</template>
            <template v-else>Сервер откроет страницу и возьмёт основной текст — без меню и подвала.</template>
          </span>
        </div>
      </form>
    </UiCard>

    <template v-if="result">
      <div class="stats">
        <UiStat
          v-if="uniq"
          label="Уникальность"
          :value="uniq.percent === null ? '—' : `${uniq.percent}%`"
          :tone="uniqTone(uniq.percent)"
          :hint="uniq.matches.length ? `совпадения: ${uniq.matches.length}` : 'совпадений не нашлось'"
        />
        <UiStat
          label="Похоже на нейросеть"
          :value="pct(result.probability)"
          :tone="tone(result.verdict)"
          :hint="result.report.verdict.label"
        />
        <UiStat label="Слов" :value="result.words" :hint="`${result.report.rhythm.sentences} предложений`" />
        <UiStat
          label="Штампов"
          :value="result.report.markers.length"
          :tone="result.report.markers.length ? 'warning' : 'neutral'"
          :hint="result.report.markerSummary.map(s => s.label.toLowerCase()).slice(0, 2).join(', ') || 'не нашлось'"
        />
        <UiStat
          label="Фрагментов похожи на ИИ"
          :value="result.report.fragments.length
            ? `${result.report.fragments.filter(f => f.probability >= 0.6).length} из ${result.report.fragments.length}`
            : '—'"
          :hint="result.report.fragments.length ? 'по 40–150 слов' : 'текст оценён целиком'"
        />
      </div>

      <UiAlert v-for="warning in result.report.warnings" :key="warning" tone="info">{{ warning }}</UiAlert>

      <UiCard>
        <div class="result-head">
          <div>
            <h2 class="section-title">
              {{ result.title || (result.source === 'url' ? result.url : 'Проверенный текст') }}
            </h2>
            <p class="admin-muted section-note">
              {{ formatDateTime(result.createdAt) }}
              <template v-if="result.createdBy"> · {{ result.createdBy }}</template>
              <template v-if="result.url"> · <a :href="result.url" target="_blank" rel="noopener noreferrer">{{ result.url }}</a></template>
              <template v-if="result.report.picked"> · взят блок «{{ result.report.picked }}»</template>
              · модель {{ result.model }}
            </p>
          </div>
          <UiButton variant="secondary" size="sm" @click="editAgain">Править и проверить снова</UiButton>
        </div>

        <UiTabs v-if="uniq" v-model="highlight" :tabs="highlightTabs" />
        <div v-if="highlight === 'ai'" class="legend">
          <span><mark class="seg lvl-ai">так</mark> фрагмент похож на нейросеть</span>
          <span><mark class="seg lvl-likely-ai">так</mark> скорее нейросеть</span>
          <span><span class="seg has-marker">так</span> штамп — наведите, чтобы увидеть какой</span>
        </div>
        <div v-else class="legend">
          <span><mark class="seg is-copy">так</mark> этот кусок уже есть в другом тексте — наведите, чтобы увидеть где</span>
        </div>
        <div class="checked-text">
          <span
            v-for="(seg, k) in segments"
            :key="k"
            class="seg"
            :class="segClass(seg)"
            :title="segTitle(seg)"
          >{{ seg.text }}</span>
        </div>
      </UiCard>

      <UiCard v-if="uniq">
        <h2 class="section-title">Где уже есть этот текст</h2>
        <p class="admin-muted section-note">
          Сравнивали с: {{ uniq.scope.join('; ') || 'ничем — ни каталога, ни адресов' }}.
          Конкурентов ищем поиском их сайтов (список ниже), не поисковиком: кого нет в списке, того не видно.
        </p>
        <UiAlert v-for="warning in uniq.warnings" :key="warning" tone="info">{{ warning }}</UiAlert>
        <UiEmpty v-if="!uniq.matches.length" title="Совпадений не нашлось" />
        <ul v-else class="match-list">
          <li v-for="(match, i) in uniq.matches" :key="i">
            <strong class="match-share">{{ match.share }}%</strong>
            <span class="admin-muted">{{ MATCH_KINDS[match.kind] }}<template v-if="match.supplier"> · {{ match.supplier }}</template></span>
            <a v-if="match.url" :href="match.url" target="_blank" rel="noopener noreferrer">{{ match.title }}</a>
            <span v-else>{{ match.title }}</span>
          </li>
        </ul>
      </UiCard>

      <div class="columns">
        <UiCard>
          <h2 class="section-title">Что переписать</h2>
          <p class="admin-muted section-note">
            Штампы сами по себе не доказывают нейросеть (у копирайтеров их тоже полно), но именно их видит читатель.
          </p>
          <UiEmpty v-if="!result.report.markerSummary.length" title="Штампов не нашлось" />
          <ul v-else class="marker-list">
            <li v-for="entry in result.report.markerSummary" :key="entry.kind">
              <strong>{{ entry.label }}</strong>
              <span class="admin-muted"> — {{ entry.count }} ({{ entry.per100Words }} на 100 слов)</span>
              <div class="examples">
                <code v-for="example in entry.examples" :key="example">{{ example }}</code>
              </div>
            </li>
          </ul>
        </UiCard>

        <UiCard>
          <h2 class="section-title">Ритм текста</h2>
          <dl class="rhythm">
            <dt>Средняя длина предложения</dt>
            <dd>{{ result.report.rhythm.avgSentenceWords }} слов</dd>
            <dt>Разброс длины предложений</dt>
            <dd>
              {{ result.report.rhythm.burstiness ?? '—' }}
              <span class="admin-muted">— у людей обычно больше: короткие вперемешку с длинными</span>
            </dd>
            <dt>Разнообразие слов</dt>
            <dd>
              {{ result.report.rhythm.lexicalVariety ?? '—' }}
              <span class="admin-muted">— доля разных слов в окне из 50</span>
            </dd>
          </dl>
          <p class="admin-muted section-note">
            Эти числа — подсказка, а не приговор: по отдельности они почти ничего не значат. Решает модель.
          </p>
        </UiCard>
      </div>
    </template>

    <details class="compare competitors">
      <summary>Сайты конкурентов, где ищем товар</summary>
      <p class="admin-muted section-note">
        По строке на сайт: название и адрес поиска, где <code>{q}</code> — место для названия товара.
        Агрегатор (shop.by) хорош тем, что из его выдачи открываются карточки самих магазинов.
        Пустой список — вернуть стандартный.
      </p>
      <UiTextarea v-model="competitorsText" :rows="4" :disabled="isSeo" :placeholder="competitorsDefaults" />
      <div v-if="!isSeo" class="check-actions">
        <UiButton variant="secondary" :loading="busy === 'competitors'" @click="saveCompetitors">Сохранить список</UiButton>
      </div>
    </details>

    <details class="about">
      <summary>Как это работает и чему верить</summary>
      <ul>
        <li>
          Оценку даёт русская модель-классификатор (ModernBERT, 34 млн параметров), обученная на корпусе LLMTrace:
          ~340 тысяч текстов людей и моделей — ChatGPT, GigaChat, YandexGPT, DeepSeek, Qwen, Llama и других.
          На отложенной выборке авторов: точность 96%, людей ошибочно принимает за ИИ в 3,4% случаев.
        </li>
        <li>
          Учили на статьях, новостях, отзывах, вопросах — <b>не на карточках товаров</b>. На описаниях из пары
          предложений она ошибается чаще, а шаблонный SEO-копирайтинг поставщиков из 2010-х бывает похож на
          нейросеть: проверяйте выводы на своих примерах.
        </li>
        <li>
          Детектор обманывается перефразированием и ручной правкой — это общее свойство всех детекторов
          (исследования RAID, Weber-Wulff). Низкий процент не значит «точно человек», высокий — повод
          перечитать, а не доказательство.
        </li>
        <li>
          Поисковики, по их собственным словам, оценивают пользу текста, а не способ его написания. Детектор
          полезен как зеркало: где текст ровный, общий и в штампах — там его и стоит переписать фактами.
        </li>
        <li>
          <b>Уникальность</b> считается как в text.ru и Advego — по «шинглам», кускам из 4 значимых слов подряд
          (регистр, ё и знаки препинания не важны): доля слов, которые не входят ни в один совпавший кусок.
          Сравнение — с текстом поставщика этого товара и похожими товарами (если проверяется наша страница
          товара), со всем нашим каталогом и текстами поставщиков (по индексу: окончания слов не важны —
          «высокую» и «высокой» одно слово), с карточками этого товара у конкурентов (поиск их сайтов) и со
          страницами из поля сравнения. Поисковики из одинаковых карточек разных магазинов показывают одну —
          текст поставщика есть у всех, кто им торгует.
        </li>
        <li>Текст проверяется на нашем сервере и никуда не отправляется. История хранится год.</li>
      </ul>
    </details>

    <UiCard>
      <h2 class="section-title">История проверок</h2>
      <UiSkeleton v-if="historyLoading && !history.length" height="160px" radius="var(--radius-md)" />
      <UiTable v-else :columns="historyColumns" :rows="history" row-key="id" empty-text="Проверок пока не было.">
        <template #cell-createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        <template #cell-what="{ row }">
          <button type="button" class="link-button" @click="open(row.id)">
            {{ row.title || row.url || 'Текст' }}
          </button>
          <span v-if="row.source === 'url' && row.title" class="admin-muted url"> · {{ row.url }}</span>
        </template>
        <template #cell-probability="{ row }">
          <UiBadge :tone="tone(row.verdict)" size="sm">{{ pct(row.probability) }} · {{ VERDICT_LABELS[row.verdict] ?? row.verdict }}</UiBadge>
        </template>
        <template #cell-createdBy="{ row }">{{ row.createdBy ?? '—' }}</template>
        <template #cell-actions="{ row }">
          <UiButton
            variant="ghost"
            size="sm"
            icon-only
            :loading="busy === `del-${row.id}`"
            aria-label="Удалить"
            @click="remove(row.id)"
          >
            <UiIcon name="trash" />
          </UiButton>
        </template>
      </UiTable>
      <UiPagination
        v-if="historyPages > 1"
        :page="historyPage"
        :pages="historyPages"
        :total="historyTotal"
        @change="setHistoryPage"
      />
    </UiCard>
  </div>
</template>

<style scoped>
.check-form {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.check-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.hint {
  font-size: var(--text-sm);
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-3);
}

.result-head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  align-items: flex-start;
  flex-wrap: wrap;
}

.section-title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-lg);
  overflow-wrap: anywhere;
}

.section-note {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin-bottom: var(--space-3);
}

.checked-text {
  white-space: pre-wrap;
  line-height: var(--leading-normal);
  max-height: 560px;
  overflow-y: auto;
  padding: var(--space-4);
  background: var(--surface-sunken);
  border-radius: var(--radius-md);
  overflow-wrap: anywhere;
}

.seg {
  background: transparent;
  color: inherit;
}

.seg.lvl-ai {
  background: var(--danger-soft);
}

.seg.lvl-likely-ai {
  background: var(--warning-soft);
}

.seg.is-copy {
  background: var(--info-soft);
  border-radius: 2px;
}

.compare {
  margin-top: var(--space-2);

  summary {
    cursor: pointer;
    color: var(--text-muted);
    margin-bottom: var(--space-2);
  }
}

.match-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);

  li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
  }
}

.match-share {
  min-width: 3.5em;
  font-variant-numeric: tabular-nums;
}

.seg.has-marker {
  text-decoration: underline wavy var(--danger);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  cursor: help;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}

.marker-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--space-3);
}

.examples {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.rhythm {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-4);
  margin: 0 0 var(--space-3);
}

.rhythm dt {
  color: var(--text-muted);
}

.rhythm dd {
  margin: 0;
}

.about {
  font-size: var(--text-sm);
  color: var(--text-default);
}

.about summary {
  cursor: pointer;
  font-weight: 600;
}

.about ul {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-5);
  display: grid;
  gap: var(--space-2);
}

.link-button {
  background: none;
  border: 0;
  padding: 0;
  color: var(--text-link);
  cursor: pointer;
  text-align: left;
  font: inherit;
  overflow-wrap: anywhere;
}

.url {
  overflow-wrap: anywhere;
}

@media (max-width: 900px) {
  .columns {
    grid-template-columns: 1fr;
  }

  .rhythm {
    grid-template-columns: 1fr;
  }
}
</style>
