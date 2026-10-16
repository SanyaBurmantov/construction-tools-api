<script setup lang="ts">
import type { CategoryOptionSource } from '~/utils/category-options'

definePageMeta({ layout: 'admin' })

type Scope = 'GLOBAL' | 'CATEGORY' | 'BRAND' | 'SOURCE'
type Rounding = 'NONE' | 'INTEGER' | 'CHARM_90' | 'CHARM_99' | 'TENS'

type PricingRule = {
  id: string
  name: string
  scope: Scope
  categoryId: string | null
  brandId: string | null
  sourceId: string | null
  minCost: number | null
  maxCost: number | null
  markupPercent: number
  markupFixed: number
  minMargin: number | null
  rounding: Rounding
  priority: number
  isActive: boolean
  category?: { id: string, name: string } | null
  brand?: { id: string, name: string } | null
  source?: { id: string, name: string } | null
}

type ReviewItem = {
  id: string
  name: string
  slug: string
  costPrice: number | null
  priceValue: number | null
  priceCurrency: string | null
  pendingCost: number | null
  flaggedAt: string | null
}

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()
const { run, busy } = useAdminAction()

const rules = ref<PricingRule[]>([])
const reviewQueue = ref<ReviewItem[]>([])
const categories = ref<CategoryOptionSource[]>([])
const brands = ref<Array<{ id: string, name: string }>>([])
const sources = ref<Array<{ id: string, name: string }>>([])

const loading = ref(true)
const loadError = ref('')

/**
 * Rules and the review queue — what an action changes. The reference lists
 * (every category, brand and supplier) used to be re-fetched after each
 * accept/reject/save as well; they only feed the selects, so they load once.
 */
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [rulesData, queue] = await Promise.all([
      adminFetch<PricingRule[]>('/pricing/rules'),
      adminFetch<{ data: ReviewItem[] }>('/pricing/review-queue'),
    ])
    rules.value = rulesData
    reviewQueue.value = queue.data
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить настройки цен')
  } finally {
    loading.value = false
  }
}

/** Select options. A failure only empties a select; it is not worth an alert. */
async function loadReferences() {
  const [cats, brs, srcs] = await Promise.all([
    adminFetch<CategoryOptionSource[]>('/categories').catch(() => []),
    adminFetch<Array<{ id: string, name: string }>>('/brands').catch(() => []),
    adminFetch<Array<{ id: string, name: string }>>('/sources').catch(() => []),
  ])
  categories.value = cats
  brands.value = brs
  sources.value = srcs
}

onMounted(() => {
  void loadReferences()
  void load()
})

/* ---- Simulator ---------------------------------------------------------- */
const sim = reactive({
  cost: 100 as number | null,
  categoryId: '',
  brandId: '',
  sourceId: '',
})
const simResult = ref<{
  cost: number
  price: number | null
  rule: { id: string, name: string, scope: Scope } | null
  margin: { absolute: number | null, percent: number | null }
} | null>(null)
const simBusy = ref(false)

async function runSimulation() {
  if (sim.cost == null || sim.cost <= 0) return
  simBusy.value = true
  try {
    simResult.value = await adminFetch('/pricing/preview', {
      method: 'POST',
      body: {
        cost: Number(sim.cost),
        categoryId: sim.categoryId || undefined,
        brandId: sim.brandId || undefined,
        sourceId: sim.sourceId || undefined,
      },
    })
  } catch (error) {
    toast.error(errorMessage(error, 'Симуляция не удалась'))
  } finally {
    simBusy.value = false
  }
}

// Live preview: any change re-runs the simulation after a short pause.
let simTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [sim.cost, sim.categoryId, sim.brandId, sim.sourceId],
  () => {
    if (simTimer) clearTimeout(simTimer)
    simTimer = setTimeout(() => void runSimulation(), 350)
  }
)
onMounted(() => void runSimulation())
onBeforeUnmount(() => {
  if (simTimer) clearTimeout(simTimer)
})

/* ---- Bulk actions ------------------------------------------------------- */
const confirmRecalc = ref(false)
const confirmBackfill = ref(false)

function recalculate() {
  return run(
    () =>
      adminFetch<{ total: number, processed: number, updated: number }>(
        '/pricing/recalculate',
        { method: 'POST', body: {} },
      ),
    {
      key: 'recalc',
      error: 'Не удалось пересчитать',
      success: result => `Пересчитано ${result.processed}, изменено цен: ${result.updated}`,
      after: () => {
        confirmRecalc.value = false
        return load()
      },
    },
  )
}

function backfill() {
  return run(
    () => adminFetch<{ updated: number }>('/pricing/backfill-cost', { method: 'POST' }),
    {
      key: 'backfill',
      error: 'Не удалось перенести цены',
      success: result => `Закупочная цена проставлена у ${result.updated} товаров`,
      after: () => {
        confirmBackfill.value = false
      },
    },
  )
}

/* ---- Review queue ------------------------------------------------------- */
function resolveReview(item: ReviewItem, accept: boolean) {
  return run(
    () => adminFetch(`/pricing/review/${item.id}`, { method: 'POST', body: { accept } }),
    {
      key: `${item.id}:${accept}`,
      error: 'Не удалось применить решение',
      success: accept ? 'Новая закупка принята, цена пересчитана' : 'Прежняя цена оставлена',
      after: load,
    },
  )
}

/* ---- Rule editor -------------------------------------------------------- */
const editorOpen = ref(false)
const editing = ref<PricingRule | null>(null)
const saving = ref(false)
const formError = ref('')

const blankForm = () => ({
  name: '',
  scope: 'GLOBAL' as Scope,
  categoryId: '',
  brandId: '',
  sourceId: '',
  minCost: null as number | null,
  maxCost: null as number | null,
  markupPercent: 30 as number | null,
  markupFixed: null as number | null,
  minMargin: null as number | null,
  rounding: 'CHARM_90' as Rounding,
  priority: 0 as number | null,
  isActive: true,
})
const form = reactive(blankForm())

function openCreate() {
  editing.value = null
  Object.assign(form, blankForm())
  formError.value = ''
  editorOpen.value = true
}

function openEdit(rule: PricingRule) {
  editing.value = rule
  Object.assign(form, {
    ...blankForm(),
    name: rule.name,
    scope: rule.scope,
    categoryId: rule.categoryId ?? '',
    brandId: rule.brandId ?? '',
    sourceId: rule.sourceId ?? '',
    minCost: rule.minCost,
    maxCost: rule.maxCost,
    markupPercent: rule.markupPercent,
    markupFixed: rule.markupFixed || null,
    minMargin: rule.minMargin,
    rounding: rule.rounding,
    priority: rule.priority,
    isActive: rule.isActive,
  })
  formError.value = ''
  editorOpen.value = true
}

async function save() {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = 'Укажите название'
    return
  }

  // A cleared bound or margin goes as `null`: the update merges the body over
  // the stored rule, so an absent field kept the old value forever.
  const body = {
    name: form.name.trim(),
    scope: form.scope,
    categoryId: form.scope === 'CATEGORY' ? form.categoryId || null : null,
    brandId: form.scope === 'BRAND' ? form.brandId || null : null,
    sourceId: form.scope === 'SOURCE' ? form.sourceId || null : null,
    minCost: numOrNull(form.minCost),
    maxCost: numOrNull(form.maxCost),
    markupPercent: numOrNull(form.markupPercent) ?? 0,
    markupFixed: numOrNull(form.markupFixed) ?? 0,
    minMargin: numOrNull(form.minMargin),
    rounding: form.rounding,
    priority: numOrNull(form.priority) ?? 0,
    isActive: form.isActive,
  }

  saving.value = true
  try {
    if (editing.value) {
      await adminFetch(`/pricing/rules/${editing.value.id}`, { method: 'PATCH', body })
      toast.success('Правило сохранено')
    } else {
      await adminFetch('/pricing/rules', { method: 'POST', body })
      toast.success('Правило создано')
    }
    editorOpen.value = false
    await load()
    await runSimulation()
  } catch (error) {
    formError.value = errorMessage(error, 'Не удалось сохранить правило')
  } finally {
    saving.value = false
  }
}

const deleting = ref<PricingRule | null>(null)

async function confirmDelete() {
  const rule = deleting.value
  if (!rule) return
  await run(() => adminFetch(`/pricing/rules/${rule.id}`, { method: 'DELETE' }), {
    key: 'delete',
    error: 'Не удалось удалить правило',
    success: 'Правило удалено',
    after: () => {
      deleting.value = null
      return load()
    },
  })
}

/* ---- Display ------------------------------------------------------------ */
const SCOPE_LABELS: Record<Scope, string> = {
  GLOBAL: 'Всё',
  CATEGORY: 'Категория',
  BRAND: 'Бренд',
  SOURCE: 'Поставщик',
}
const SCOPE_TONES: Record<Scope, 'neutral' | 'brand' | 'info' | 'warning'> = {
  GLOBAL: 'neutral',
  CATEGORY: 'brand',
  BRAND: 'info',
  SOURCE: 'warning',
}
const RULE_COLUMNS = [
  { key: 'name', label: 'Правило' },
  { key: 'scope', label: 'Область' },
  { key: 'cost', label: 'Закупка', class: 'admin-muted' },
  { key: 'markup', label: 'Наценка' },
  { key: 'rounding', label: 'Округление', class: 'admin-muted' },
  { key: 'priority', label: 'Приор.', align: 'end' as const, class: 'num' },
  { key: 'actions', label: '', nowrap: true },
]
const ROUNDING_LABELS: Record<Rounding, string> = {
  NONE: 'без округления',
  INTEGER: 'до целого',
  CHARM_90: 'до .90',
  CHARM_99: 'до .99',
  TENS: 'до десятков',
}

function scopeTarget(rule: PricingRule) {
  if (rule.scope === 'CATEGORY') return rule.category?.name ?? '—'
  if (rule.scope === 'BRAND') return rule.brand?.name ?? '—'
  if (rule.scope === 'SOURCE') return rule.source?.name ?? '—'
  return 'весь каталог'
}

function markupLabel(rule: PricingRule) {
  const parts: string[] = []
  if (rule.markupPercent) parts.push(`+${rule.markupPercent}%`)
  if (rule.markupFixed) parts.push(`+${rule.markupFixed}`)
  if (rule.minMargin) parts.push(`мин. маржа ${rule.minMargin}`)
  return parts.join(', ') || '—'
}

function costBand(rule: PricingRule) {
  if (rule.minCost == null && rule.maxCost == null) return 'любая'
  if (rule.minCost != null && rule.maxCost != null) return `${rule.minCost}–${rule.maxCost}`
  return rule.minCost != null ? `от ${rule.minCost}` : `до ${rule.maxCost}`
}

const categoryOptions = computed(() => categoryTreeOptions(categories.value))
const brandOptions = computed(() => brands.value.map((b) => ({ value: b.id, label: b.name })))
const sourceOptions = computed(() => sources.value.map((s) => ({ value: s.id, label: s.name })))
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="Ценообразование"
      description="Правила наценки применяются автоматически при каждом парсинге"
    >
      <UiButton variant="secondary" @click="confirmBackfill = true">
        Перенести цены в закупку
      </UiButton>
      <UiButton variant="secondary" @click="confirmRecalc = true">Пересчитать всё</UiButton>
      <UiButton @click="openCreate">Новое правило</UiButton>
    </AdminPageHead>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <!-- Review queue -->
    <UiAlert v-if="reviewQueue.length" tone="warning" title="Цены на проверке">
      У {{ reviewQueue.length }} товаров закупочная цена изменилась слишком резко —
      витрина сохранила прежнюю цену.
    </UiAlert>

    <UiCard v-if="reviewQueue.length" title="Требуют решения" :padded="false">
      <ul class="review-list">
        <li v-for="item in reviewQueue" :key="item.id">
          <div class="review-main">
            <NuxtLink :to="`/product/${item.slug}`" target="_blank">{{ item.name }}</NuxtLink>
            <span class="review-costs">
              закупка {{ formatPrice(item.costPrice, item.priceCurrency) }}
              → <strong>{{ formatPrice(item.pendingCost, item.priceCurrency) }}</strong>
              · на витрине {{ formatPrice(item.priceValue, item.priceCurrency) }}
            </span>
          </div>
          <div class="review-actions">
            <UiButton
              size="sm"
              :loading="busy === `${item.id}:true`"
              :disabled="Boolean(busy)"
              @click="resolveReview(item, true)"
            >
              Принять новую
            </UiButton>
            <UiButton
              size="sm"
              variant="ghost"
              :loading="busy === `${item.id}:false`"
              :disabled="Boolean(busy)"
              @click="resolveReview(item, false)"
            >
              Оставить прежнюю
            </UiButton>
          </div>
        </li>
      </ul>
    </UiCard>

    <div class="grid">
      <!-- Rules -->
      <UiCard title="Правила наценки" :padded="false">
        <div v-if="loading" class="pad"><UiSkeleton :lines="5" height="18px" /></div>

        <UiEmpty
          v-else-if="!rules.length"
          icon="box"
          title="Правил пока нет"
          description="Без правил товары продаются по закупочной цене. Начните с глобальной наценки."
        >
          <UiButton @click="openCreate">Создать правило</UiButton>
        </UiEmpty>

        <UiTable
          v-else
          class="rules-table"
          :columns="RULE_COLUMNS"
          :rows="rules"
          row-key="id"
          :row-class="rule => ({ 'is-off': !rule.isActive })"
        >
          <template #cell-name="{ row: rule }">
            <button type="button" class="rule-name" @click="openEdit(rule)">
              {{ rule.name }}
            </button>
            <UiBadge v-if="!rule.isActive" tone="neutral" size="sm">выключено</UiBadge>
          </template>
          <template #cell-scope="{ row: rule }">
            <UiBadge :tone="SCOPE_TONES[rule.scope]" size="sm">
              {{ SCOPE_LABELS[rule.scope] }}
            </UiBadge>
            <span class="target">{{ scopeTarget(rule) }}</span>
          </template>
          <template #cell-cost="{ row: rule }">{{ costBand(rule) }}</template>
          <template #cell-markup="{ row: rule }">
            <strong>{{ markupLabel(rule) }}</strong>
          </template>
          <template #cell-rounding="{ row: rule }">{{ ROUNDING_LABELS[rule.rounding] }}</template>
          <template #cell-actions="{ row: rule }">
            <UiButton variant="ghost" size="sm" @click="openEdit(rule)">Изменить</UiButton>
            <UiButton variant="ghost" size="sm" @click="deleting = rule">✕</UiButton>
          </template>
        </UiTable>
      </UiCard>

      <!-- Simulator -->
      <UiCard title="Симулятор">
        <p class="sim-hint">
          Проверьте, какое правило сработает и какой будет цена, не трогая каталог.
        </p>

        <div class="sim-form">
          <UiField label="Закупочная цена" for="sim-cost">
            <UiInput id="sim-cost" v-model="sim.cost" type="number" step="0.01" min="0" />
          </UiField>

          <UiField label="Категория" for="sim-cat">
            <UiSelect
              id="sim-cat"
              v-model="sim.categoryId"
              size="sm"
              :options="[{ value: '', label: 'Любая' }, ...categoryOptions]"
            />
          </UiField>

          <UiField label="Бренд" for="sim-brand">
            <UiSelect
              id="sim-brand"
              v-model="sim.brandId"
              size="sm"
              :options="[{ value: '', label: 'Любой' }, ...brandOptions]"
            />
          </UiField>

          <UiField label="Поставщик" for="sim-source">
            <UiSelect
              id="sim-source"
              v-model="sim.sourceId"
              size="sm"
              :options="[{ value: '', label: 'Любой' }, ...sourceOptions]"
            />
          </UiField>
        </div>

        <div v-if="simResult" class="sim-result" :class="{ 'is-busy': simBusy }">
          <div class="sim-price">
            <span>Цена на витрине</span>
            <strong>{{ formatPrice(simResult.price, 'BYN') }}</strong>
          </div>
          <dl class="sim-facts">
            <div>
              <dt>Правило</dt>
              <dd>{{ simResult.rule?.name ?? 'нет — продаём по закупке' }}</dd>
            </div>
            <div>
              <dt>Маржа</dt>
              <dd>
                <template v-if="simResult.margin.absolute != null">
                  {{ formatPrice(simResult.margin.absolute, 'BYN') }}
                  ({{ simResult.margin.percent }}%)
                </template>
                <template v-else>—</template>
              </dd>
            </div>
          </dl>
        </div>
      </UiCard>
    </div>

    <!-- Rule editor -->
    <UiModal
      v-model:open="editorOpen"
      :title="editing ? 'Редактирование правила' : 'Новое правило'"
      size="md"
    >
      <UiAlert v-if="formError" tone="danger" class="form-error">{{ formError }}</UiAlert>

      <div class="admin-form">
        <UiField label="Название" required for="r-name">
          <UiInput id="r-name" v-model="form.name" placeholder="Базовая наценка" />
        </UiField>

        <UiField
          label="Область действия"
          hint="Чем уже область, тем выше приоритет: поставщик → бренд → категория → всё"
          for="r-scope"
        >
          <UiSelect
            id="r-scope"
            v-model="form.scope"
            :options="[
              { value: 'GLOBAL', label: 'Весь каталог' },
              { value: 'CATEGORY', label: 'Категория (и подкатегории)' },
              { value: 'BRAND', label: 'Бренд' },
              { value: 'SOURCE', label: 'Поставщик' }
            ]"
          />
        </UiField>

        <UiField v-if="form.scope === 'CATEGORY'" label="Категория" required for="r-cat">
          <UiSelect id="r-cat" v-model="form.categoryId" placeholder="Выберите" :options="categoryOptions" />
        </UiField>
        <UiField v-if="form.scope === 'BRAND'" label="Бренд" required for="r-brand">
          <UiSelect id="r-brand" v-model="form.brandId" placeholder="Выберите" :options="brandOptions" />
        </UiField>
        <UiField v-if="form.scope === 'SOURCE'" label="Поставщик" required for="r-src">
          <UiSelect id="r-src" v-model="form.sourceId" placeholder="Выберите" :options="sourceOptions" />
        </UiField>

        <div class="admin-form-row">
          <UiField label="Закупка от" hint="Пусто — без нижней границы" for="r-min">
            <UiInput id="r-min" v-model="form.minCost" type="number" step="0.01" min="0" />
          </UiField>
          <UiField label="Закупка до" hint="Пусто — без верхней" for="r-max">
            <UiInput id="r-max" v-model="form.maxCost" type="number" step="0.01" min="0" />
          </UiField>
        </div>

        <div class="admin-form-row">
          <UiField label="Наценка, %" for="r-pct">
            <UiInput id="r-pct" v-model="form.markupPercent" type="number" step="0.1" min="0" />
          </UiField>
          <UiField label="Надбавка, BYN" hint="Прибавляется поверх процента" for="r-fix">
            <UiInput id="r-fix" v-model="form.markupFixed" type="number" step="0.01" min="0" />
          </UiField>
        </div>

        <div class="admin-form-row">
          <UiField
            label="Минимальная маржа, BYN"
            hint="Поднимет цену, если процента мало"
            for="r-margin"
          >
            <UiInput id="r-margin" v-model="form.minMargin" type="number" step="0.01" min="0" />
          </UiField>
          <UiField label="Округление" for="r-round">
            <UiSelect
              id="r-round"
              v-model="form.rounding"
              :options="[
                { value: 'CHARM_90', label: 'До .90' },
                { value: 'CHARM_99', label: 'До .99' },
                { value: 'INTEGER', label: 'До целого' },
                { value: 'TENS', label: 'До десятков' },
                { value: 'NONE', label: 'Без округления' }
              ]"
            />
          </UiField>
        </div>

        <UiField label="Приоритет" hint="Выше — важнее при одинаковой области" for="r-prio">
          <UiInput id="r-prio" v-model="form.priority" type="number" />
        </UiField>

        <UiCheckbox v-model="form.isActive" label="Правило активно" />
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="editorOpen = false">Отмена</UiButton>
        <UiButton :loading="saving" @click="save">
          {{ editing ? 'Сохранить' : 'Создать' }}
        </UiButton>
      </template>
    </UiModal>

    <!-- Confirmations -->
    <UiConfirm
      v-model:open="confirmRecalc"
      title="Пересчитать все цены?"
      tone="primary"
      confirm-label="Пересчитать"
      :busy="busy === 'recalc'"
      @confirm="recalculate"
    >
      Цены всех товаров в режиме AUTO будут пересчитаны по текущим правилам.
      Товары с ручной ценой не изменятся. Каждое изменение попадёт в историю.
    </UiConfirm>

    <UiConfirm
      v-model:open="confirmBackfill"
      title="Перенести цены в закупочные?"
      tone="primary"
      confirm-label="Перенести"
      :busy="busy === 'backfill'"
      @confirm="backfill"
    >
      <p>
        Товарам без закупочной цены она будет проставлена из текущей цены на витрине.
        Нужно один раз, чтобы правила заработали на уже собранном каталоге.
        Повторный запуск безопасен — уже заполненные не трогаются.
      </p>
      <p class="warn">
        После этого запустите пересчёт, иначе наценка не применится.
      </p>
    </UiConfirm>

    <UiConfirm
      :open="Boolean(deleting)"
      title="Удалить правило?"
      :busy="busy === 'delete'"
      @update:open="deleting = null"
      @confirm="confirmDelete"
    >
      «{{ deleting?.name }}» перестанет действовать. Цены товаров не изменятся,
      пока вы не запустите пересчёт.
    </UiConfirm>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  align-items: start;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--space-4);
}

.pad {
  padding: var(--space-4);
}

/* ---- Rules table ---- */
/* The card is the frame; the table's own border would draw a second one. */
.rules-table {
  border: 0;
  border-radius: 0;
}

.rules-table :deep(.is-off td) {
  opacity: 0.6;
}

.rule-name {
  color: var(--text-strong);
  font-weight: 700;
}

.rule-name:hover {
  color: var(--text-link);
}

.target {
  display: block;
  margin-top: 2px;
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.rules-table :deep(.num) {
  font-variant-numeric: tabular-nums;
}

/* ---- Simulator ---- */
.sim-hint {
  margin-bottom: var(--space-4);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.sim-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.sim-result {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  transition: opacity var(--duration-fast) var(--ease-out);
}

.sim-result.is-busy {
  opacity: 0.5;
}

.sim-price {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--space-3);
}

.sim-price span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.sim-price strong {
  color: var(--brand);
  font-size: var(--text-2xl);
  font-weight: 800;
  letter-spacing: var(--tracking-tight);
}

.sim-facts {
  display: flex;
  flex-direction: column;
  margin: 0;
  gap: var(--space-2);
}

.sim-facts > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: var(--text-sm);
}

.sim-facts dt {
  color: var(--text-muted);
}

.sim-facts dd {
  margin: 0;
  color: var(--text-strong);
  font-weight: 600;
  text-align: right;
}

/* ---- Review queue ---- */
.review-list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}

.review-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  gap: var(--space-3);
}

.review-list li:last-child {
  border-bottom: 0;
}

.review-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.review-main a {
  color: var(--text-strong);
  font-weight: 600;
}

.review-main a:hover {
  color: var(--text-link);
}

.review-costs {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.review-costs strong {
  color: var(--sale);
}

.review-actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-2);
}

/* ---- Forms ---- */
.form-error {
  margin-bottom: var(--space-4);
}

.warn {
  margin-top: var(--space-3);
  color: var(--warning-soft-text);
  font-weight: 600;
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
