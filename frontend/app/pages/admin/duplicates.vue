<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type Signal = 'barcode' | 'sku' | 'model' | 'name'
type Confidence = 'exact' | 'strong' | 'likely' | 'weak'

type DuplicateProduct = {
  id: string
  name: string
  slug: string
  sku: string | null
  barcode: string | null
  model: string | null
  costPrice: number | null
  priceValue: number | null
  brandName: string | null
  offerCount: number
  image: string | null
}

type DuplicateGroup = {
  signal: Signal
  confidence: Confidence
  key: string
  products: DuplicateProduct[]
}

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()
const { formatPrice } = useFormatPrice()

const groups = ref<DuplicateGroup[]>([])
const loading = ref(true)
const loadError = ref('')
const busy = ref(false)

/** Chosen survivor per group; defaults to the one carrying the most offers. */
const chosen = reactive<Record<string, string>>({})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    groups.value = await adminFetch<DuplicateGroup[]>('/offers/duplicates')
    for (const group of groups.value) {
      if (!chosen[group.key]) {
        const best = [...group.products].sort((a, b) => b.offerCount - a.offerCount)[0]
        if (best) chosen[group.key] = best.id
      }
    }
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить дубли')
  } finally {
    loading.value = false
  }
}

onMounted(load)

const confirmAuto = ref(false)

async function rebuildKeys() {
  busy.value = true
  try {
    const result = await adminFetch<{ processed: number }>('/offers/rebuild-keys', {
      method: 'POST',
    })
    toast.success(`Ключи пересобраны у ${result.processed} товаров`)
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось пересобрать ключи'))
  } finally {
    busy.value = false
  }
}

async function autoMerge() {
  busy.value = true
  try {
    const result = await adminFetch<{ groups: number, merged: number, skipped: number }>(
      '/offers/auto-merge',
      { method: 'POST' }
    )
    toast.success(
      `Объединено товаров: ${result.merged}. Оставлено на ручное решение: ${result.skipped}`
    )
    confirmAuto.value = false
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Автослияние не удалось'))
  } finally {
    busy.value = false
  }
}

/** Folds every other product in the group into the chosen survivor. */
async function mergeGroup(group: DuplicateGroup) {
  const targetId = chosen[group.key]
  if (!targetId) return

  busy.value = true
  try {
    for (const product of group.products) {
      if (product.id === targetId) continue
      await adminFetch('/offers/merge', {
        method: 'POST',
        body: { targetId, duplicateId: product.id },
      })
    }
    toast.success('Товары объединены')
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось объединить'))
  } finally {
    busy.value = false
  }
}

const SIGNAL_LABELS: Record<Signal, string> = {
  barcode: 'Штрихкод',
  sku: 'Бренд + артикул',
  model: 'Бренд + модель',
  name: 'Похожее название',
}
const CONFIDENCE_LABELS: Record<Confidence, string> = {
  exact: 'точное совпадение',
  strong: 'высокая уверенность',
  likely: 'вероятно',
  weak: 'слабое',
}
const CONFIDENCE_TONES: Record<Confidence, 'success' | 'brand' | 'warning' | 'neutral'> = {
  exact: 'success',
  strong: 'brand',
  likely: 'warning',
  weak: 'neutral',
}

const autoMergeableCount = computed(
  () => groups.value.filter((g) => g.confidence === 'exact' || g.confidence === 'strong').length
)
</script>

<template>
  <div class="admin-duplicates">
    <header class="head">
      <div>
        <h1>Дубли товаров</h1>
        <p>Один товар от разных поставщиков — одна карточка и несколько предложений</p>
      </div>
      <div class="head-actions">
        <UiButton variant="secondary" :loading="busy" @click="rebuildKeys">
          Пересобрать ключи
        </UiButton>
        <UiButton :disabled="!autoMergeableCount" @click="confirmAuto = true">
          Объединить надёжные ({{ autoMergeableCount }})
        </UiButton>
      </div>
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <UiAlert tone="info">
      Автоматически объединяются только совпадения по штрихкоду и по паре
      «бренд + артикул». Совпадения по модели и названию требуют вашего решения —
      ошибочное слияние разбирать дорого.
    </UiAlert>

    <div v-if="loading" class="list">
      <UiSkeleton v-for="i in 3" :key="i" height="160px" radius="var(--radius-md)" />
    </div>

    <UiEmpty
      v-else-if="!groups.length"
      icon="box"
      title="Дублей не найдено"
      description="Если каталог только что собран, сначала пересоберите ключи сопоставления."
    >
      <UiButton variant="secondary" :loading="busy" @click="rebuildKeys">
        Пересобрать ключи
      </UiButton>
    </UiEmpty>

    <ul v-else class="list">
      <li v-for="group in groups" :key="group.key" class="group">
        <header class="group-head">
          <div class="group-title">
            <UiBadge :tone="CONFIDENCE_TONES[group.confidence]" size="sm">
              {{ CONFIDENCE_LABELS[group.confidence] }}
            </UiBadge>
            <span>{{ SIGNAL_LABELS[group.signal] }}</span>
            <code>{{ group.key }}</code>
          </div>
          <UiButton size="sm" :loading="busy" @click="mergeGroup(group)">
            Объединить в выбранный
          </UiButton>
        </header>

        <div class="candidates">
          <label
            v-for="product in group.products"
            :key="product.id"
            class="candidate"
            :class="{ 'is-target': chosen[group.key] === product.id }"
          >
            <input v-model="chosen[group.key]" type="radio" :value="product.id">

            <div class="candidate-thumb">
              <img v-if="product.image" :src="product.image" :alt="product.name" loading="lazy">
              <span v-else aria-hidden="true" />
            </div>

            <div class="candidate-body">
              <NuxtLink :to="`/product/${product.slug}`" target="_blank" class="candidate-name">
                {{ product.name }}
              </NuxtLink>
              <span class="candidate-meta">
                <span v-if="product.brandName">{{ product.brandName }}</span>
                <span v-if="product.sku">арт. {{ product.sku }}</span>
                <span>{{ product.offerCount }} предл.</span>
              </span>
            </div>

            <div class="candidate-prices">
              <strong>{{ formatPrice(product.priceValue, 'BYN') }}</strong>
              <span v-if="product.costPrice">закупка {{ product.costPrice }}</span>
            </div>

            <span class="candidate-flag">
              {{ chosen[group.key] === product.id ? 'останется' : 'присоединится' }}
            </span>
          </label>
        </div>
      </li>
    </ul>

    <UiModal v-model:open="confirmAuto" title="Объединить надёжные дубли?" size="sm">
      <p class="confirm-text">
        Будут объединены только группы, совпавшие по штрихкоду или по паре
        «бренд + артикул» — {{ autoMergeableCount }} шт. Останется карточка
        с наибольшим числом предложений, остальные присоединятся к ней.
      </p>
      <p class="confirm-text warn">
        Отзывы, характеристики и история цен переносятся, старые адреса начнут
        вести на выжившую карточку. Отменить слияние нельзя.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="confirmAuto = false">Отмена</UiButton>
        <UiButton :loading="busy" @click="autoMerge">Объединить</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.admin-duplicates {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.head h1 {
  font-size: var(--text-2xl);
}

.head p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-4);
  list-style: none;
}

.group {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-sunken);
  gap: var(--space-3);
}

.group-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.group-title code {
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.candidates {
  display: flex;
  flex-direction: column;
}

.candidate {
  display: grid;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  gap: var(--space-3);
  grid-template-columns: 44px minmax(0, 1fr) auto auto;
}

.candidate:last-child {
  border-bottom: 0;
}

.candidate:hover {
  background: var(--surface-hover);
}

.candidate.is-target {
  background: var(--success-soft);
}

.candidate input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.candidate-thumb {
  width: 44px;
  height: 44px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xs);
  background: var(--surface-card);
}

.candidate-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.candidate-thumb span {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
}

.candidate-body {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.candidate-name {
  overflow: hidden;
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.candidate-name:hover {
  color: var(--text-link);
}

.candidate-meta {
  display: flex;
  flex-wrap: wrap;
  color: var(--text-subtle);
  font-size: var(--text-xs);
  gap: var(--space-2);
}

.candidate-prices {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: var(--text-sm);
}

.candidate-prices strong {
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}

.candidate-prices span {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.candidate-flag {
  min-width: 96px;
  color: var(--text-subtle);
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: right;
}

.is-target .candidate-flag {
  color: var(--success-soft-text);
}

.confirm-text {
  color: var(--text-muted);
}

.confirm-text.warn {
  margin-top: var(--space-3);
  color: var(--warning-soft-text);
  font-weight: 600;
}

@media (max-width: 700px) {
  .candidate {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .candidate-prices,
  .candidate-flag {
    grid-column: 2;
    align-items: flex-start;
    text-align: left;
  }
}
</style>
