<script setup lang="ts">
import type { ProductDetail } from '~/types/api'
import { useCompareStore } from '~/stores/compare'
import { useCartStore } from '~/stores/cart'

const compare = useCompareStore()
const cart = useCartStore()
const toast = useAppToast()
const { apiBase } = useSite()

const products = ref<ProductDetail[]>([])
const loading = ref(false)
const loadError = ref('')
/** When on, rows where every product agrees are hidden. */
const onlyDifferences = ref(false)

/**
 * Syncs the table with the store. Products already on screen are kept (a
 * removal is a local filter, not four new requests); only slugs not loaded
 * yet are fetched. A single 404 just drops that column (unpublished since),
 * but when every request fails the page says so instead of «Нечего сравнивать».
 */
async function loadProducts() {
  const slugs = compare.slugs
  const loaded = new Map(products.value.map(product => [product.slug, product]))
  const missing = slugs.filter(slug => !loaded.has(slug))
  loadError.value = ''

  if (missing.length) {
    loading.value = true
    let failed = 0
    const results = await Promise.all(
      missing.map(slug =>
        $fetch<ProductDetail>(`${apiBase}/products/${slug}`).catch((error) => {
          if (isApiUnavailable(error)) failed += 1
          return null
        })
      )
    )
    for (const product of results) if (product) loaded.set(product.slug, product)
    if (failed === missing.length) loadError.value = 'Не удалось загрузить товары для сравнения'
    loading.value = false
  }

  // Keep the store's order.
  products.value = slugs
    .map(slug => loaded.get(slug))
    .filter((product): product is ProductDetail => Boolean(product))
}

onMounted(() => {
  compare.load()
  void loadProducts()
})

// Re-sync when the list changes (removal from the table or the compare bar).
watch(() => compare.slugs.join(','), () => void loadProducts())

/** Same wording as the product card's availability, without the quantity. */
function stockLabel(product: ProductDetail) {
  if (product.stockStatus === 'in_stock') return 'В наличии'
  if (product.stockStatus === 'out_of_stock') return 'Под заказ'
  return 'Уточняйте наличие'
}

/* ---- Row model --------------------------------------------------------- */
type Row = { label: string, values: string[], differs: boolean }

function buildRow(label: string, values: Array<string | null | undefined>): Row {
  const normalized = values.map((v) => (v == null || v === '' ? '—' : String(v)))
  return {
    label,
    values: normalized,
    differs: new Set(normalized).size > 1,
  }
}

const baseRows = computed<Row[]>(() => {
  const list = products.value
  if (!list.length) return []

  return [
    buildRow('Цена', list.map((p) => formatPrice(p.priceValue, p.priceCurrency))),
    buildRow('Бренд', list.map((p) => p.brand?.name)),
    buildRow('Категория', list.map((p) => p.category?.name)),
    buildRow('Артикул', list.map((p) => p.sku)),
    buildRow('Модель', list.map((p) => p.model)),
    buildRow('Наличие', list.map(stockLabel)),
    buildRow(
      'Рейтинг',
      list.map((p) => (p.ratingCount ? `${p.ratingAvg?.toFixed(1)} (${p.ratingCount})` : null))
    ),
  ]
})

/** Union of every spec name across the compared products, in first-seen order. */
const specRows = computed<Row[]>(() => {
  const list = products.value
  if (!list.length) return []

  const names: string[] = []
  for (const product of list) {
    for (const spec of product.productSpecs ?? []) {
      if (!names.includes(spec.name)) names.push(spec.name)
    }
  }

  return names.map((name) =>
    buildRow(
      name,
      list.map((p) => p.productSpecs?.find((s) => s.name === name)?.value)
    )
  )
})

const visibleBaseRows = computed(() =>
  onlyDifferences.value ? baseRows.value.filter((r) => r.differs) : baseRows.value
)
const visibleSpecRows = computed(() =>
  onlyDifferences.value ? specRows.value.filter((r) => r.differs) : specRows.value
)

const differenceCount = computed(
  () => [...baseRows.value, ...specRows.value].filter((r) => r.differs).length
)

function addToCart(product: ProductDetail) {
  const line = toCartLine(product)
  if (!line) return
  cart.add(line)
  toast.success(`«${product.name}» в корзине`)
}

useHead({
  title: 'Сравнение товаров | Gost.by',
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
})
</script>

<template>
  <div class="compare-page">
    <UiBreadcrumbs :items="[{ label: 'Главная', to: '/' }, { label: 'Сравнение' }]" />

    <header class="page-head">
      <div>
        <h1>Сравнение товаров</h1>
        <p v-if="products.length" class="subtitle">
          {{ pluralize(products.length, 'product') }} · {{ pluralize(differenceCount, 'difference') }}
        </p>
      </div>

      <div v-if="products.length" class="head-actions">
        <UiCheckbox v-model="onlyDifferences" label="Только отличия" />
        <UiButton variant="ghost" size="sm" @click="compare.clear()">Очистить</UiButton>
      </div>
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <UiSkeleton v-if="loading" height="400px" radius="var(--radius-md)" />

    <UiEmpty
      v-else-if="!products.length && !loadError"
      icon="box"
      title="Нечего сравнивать"
      description="Добавьте до четырёх товаров из каталога — и увидите их характеристики бок о бок."
    >
      <UiButton to="/catalog">Перейти в каталог</UiButton>
    </UiEmpty>

    <div v-else-if="products.length" class="table-scroll scroll-x">
      <table class="compare-table">
        <thead>
          <tr>
            <th class="label-col">Характеристика</th>
            <th v-for="product in products" :key="product.id" class="product-col">
              <div class="product-head">
                <button
                  type="button"
                  class="remove"
                  :aria-label="`Убрать ${product.name} из сравнения`"
                  @click="compare.remove(product.id)"
                >
                  <UiIcon name="close" :stroke-width="1.8" />
                </button>

                <NuxtLink :to="`/product/${product.slug}`" class="thumb">
                  <img
                    v-if="product.images?.length"
                    :src="product.images[0]!.url"
                    :alt="product.name"
                    loading="lazy"
                  >
                  <span v-else class="thumb-empty" aria-hidden="true" />
                </NuxtLink>

                <NuxtLink :to="`/product/${product.slug}`" class="product-name">
                  {{ product.name }}
                </NuxtLink>

                <UiPrice
                  :value="product.priceValue"
                  :old-price="product.oldPrice"
                  :currency="product.priceCurrency"
                  size="sm"
                />

                <UiButton
                  v-if="product.priceValue"
                  size="sm"
                  block
                  @click="addToCart(product)"
                >
                  В корзину
                </UiButton>
              </div>
            </th>
          </tr>
        </thead>

        <tbody>
          <tr v-if="visibleBaseRows.length" class="section-row">
            <td :colspan="products.length + 1">Основное</td>
          </tr>
          <tr
            v-for="row in visibleBaseRows"
            :key="`base-${row.label}`"
            :class="{ 'is-diff': row.differs }"
          >
            <th scope="row">{{ row.label }}</th>
            <td v-for="(value, index) in row.values" :key="index">{{ value }}</td>
          </tr>

          <tr v-if="visibleSpecRows.length" class="section-row">
            <td :colspan="products.length + 1">Характеристики</td>
          </tr>
          <tr
            v-for="row in visibleSpecRows"
            :key="`spec-${row.label}`"
            :class="{ 'is-diff': row.differs }"
          >
            <th scope="row">{{ row.label }}</th>
            <td v-for="(value, index) in row.values" :key="index">{{ value }}</td>
          </tr>

          <tr v-if="onlyDifferences && !visibleBaseRows.length && !visibleSpecRows.length">
            <td :colspan="products.length + 1" class="no-diff">
              Различий между выбранными товарами нет.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.compare-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
}

.subtitle {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.table-scroll {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.compare-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.label-col {
  position: sticky;
  left: 0;
  z-index: 2;
  width: 200px;
  min-width: 160px;
  background: var(--surface-card);
}

.product-col {
  min-width: 220px;
}

.product-head {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--space-4);
  gap: var(--space-2);
  text-align: left;
}

.remove {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  display: grid;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-full);
  color: var(--text-subtle);
  place-items: center;
}

.remove:hover {
  background: var(--surface-active);
  color: var(--danger);
}

.remove svg {
  width: 14px;
  height: 14px;
}

.thumb {
  display: block;
  width: 100%;
  height: 120px;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.thumb-empty {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.product-name {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.product-name:hover {
  color: var(--text-link);
}

thead th {
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: top;
}

.section-row td {
  padding: var(--space-2) var(--space-4);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

tbody th {
  position: sticky;
  left: 0;
  z-index: 1;
  padding: var(--space-3) var(--space-4);
  background: var(--surface-card);
  color: var(--text-muted);
  font-weight: 600;
  text-align: left;
}

tbody td {
  padding: var(--space-3) var(--space-4);
  border-left: 1px solid var(--border-subtle);
  color: var(--text-default);
  vertical-align: top;
}

tbody tr {
  border-top: 1px solid var(--border-subtle);
}

/* Rows where the products disagree get a subtle highlight — that's the whole
   point of the page, so it needs to be findable at a glance. */
.is-diff th,
.is-diff td {
  background: var(--warning-soft);
}

.is-diff td {
  color: var(--text-strong);
  font-weight: 600;
}

.no-diff {
  padding: var(--space-8);
  color: var(--text-muted);
  text-align: center;
}
</style>
