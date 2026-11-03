<script setup lang="ts">
import { categoryTreeOptions, type CategoryOptionSource } from '~/utils/category-options'

definePageMeta({ layout: 'admin' })

/**
 * What the storefront shows by hand rather than by rule (backend
 * `storefront/`):
 * - the strip under the header on every page (and «Популярное:» under the
 *   home page search) — categories of any level, in this order;
 * - «Выбирают покупатели» on the home page — products, in this order.
 * An empty list puts the automatic choice back. A category with nothing on
 * sale, or a hidden one, drops out of the strip on its own and is marked here.
 */
type CategoryPick = {
  categoryId: string
  label: string | null
  highlight: boolean
  name: string | null
  slug: string | null
  productCount: number
  shown: boolean
}
type ProductPick = {
  id: string
  name: string | null
  slug: string | null
  status: string | null
  priceValue: number | null
  image: string | null
  shown: boolean
}
type View = { headerCategories: CategoryPick[], popularProducts: ProductPick[] }
type SearchProduct = {
  id: string
  name: string
  slug: string
  status: string
  priceValue: number | null
  images?: Array<{ url: string }>
}

const MAX_CATEGORIES = 20
const MAX_PRODUCTS = 24

const { adminFetch } = useAdminApi()
const { run, busy } = useAdminAction()
const { formatPrice } = useFormatPrice()

const loading = ref(true)
const loadError = ref('')
const categories = ref<CategoryPick[]>([])
const products = ref<ProductPick[]>([])
const allCategories = ref<CategoryOptionSource[]>([])
const savedSnapshot = ref('')

const snapshot = () => JSON.stringify(payload())
const dirty = computed(() => !loading.value && snapshot() !== savedSnapshot.value)

function fill(view: View) {
  categories.value = view.headerCategories.map(row => ({ ...row, label: row.label ?? '' }))
  products.value = view.popularProducts
  savedSnapshot.value = snapshot()
}

onMounted(async () => {
  try {
    const [view, list] = await Promise.all([
      adminFetch<View>('/storefront'),
      adminFetch<CategoryOptionSource[]>('/categories'),
    ])
    allCategories.value = list
    fill(view)
  }
  catch {
    loadError.value = 'Не удалось загрузить настройки витрины'
  }
  finally {
    loading.value = false
  }
})

function payload() {
  return {
    headerCategories: categories.value.map(({ categoryId, label, highlight }) => ({
      categoryId,
      label: label?.trim() || null,
      highlight,
    })),
    popularProducts: products.value.map(row => row.id),
  }
}

async function save() {
  const view = await run(
    () => adminFetch<View>('/storefront', { method: 'PUT', body: payload() }),
    { key: 'save', error: 'Не удалось сохранить', success: 'Витрина сохранена' }
  )
  if (view) fill(view)
}

function move<T>(list: T[], index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= list.length) return
  const [row] = list.splice(index, 1)
  list.splice(target, 0, row!)
}

/* ---------------------------------------------------------- categories */

const categoryById = computed(() => new Map(allCategories.value.map(c => [c.id, c])))
const categoryOptions = computed(() => {
  const taken = new Set(categories.value.map(row => row.categoryId))
  return categoryTreeOptions(allCategories.value).map(option => ({
    ...option,
    disabled: taken.has(option.value),
  }))
})
const categoryToAdd = ref('')

function addCategory() {
  const category = categoryById.value.get(categoryToAdd.value)
  if (!category || categories.value.length >= MAX_CATEGORIES) return
  if (categories.value.some(row => row.categoryId === category.id)) return
  categories.value.push({
    categoryId: category.id,
    label: '',
    highlight: false,
    name: category.name,
    slug: (category as { slug?: string }).slug ?? null,
    productCount: 0,
    // Not known until saved: the server checks it is listable.
    shown: true,
  })
  categoryToAdd.value = ''
}

/** «Каталог / Крепеж / Нержавеющий крепеж» — where a pick sits in the tree. */
function categoryPath(id: string) {
  const names: string[] = []
  let at = categoryById.value.get(id)
  while (at) {
    names.unshift(at.name)
    at = at.parentId ? categoryById.value.get(at.parentId) : undefined
  }
  return names.length > 1 ? names.slice(0, -1).join(' / ') : ''
}

/* ------------------------------------------------------------ products */

const productQuery = ref('')
const productResults = ref<SearchProduct[]>([])
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchSeq = 0

watch(productQuery, (value) => {
  clearTimeout(searchTimer)
  const term = value.trim()
  if (term.length < 2) {
    productResults.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq
    searching.value = true
    try {
      const page = await adminFetch<{ data: SearchProduct[] }>('/products', {
        params: { search: term, status: 'PUBLISHED', limit: 10 },
      })
      if (seq === searchSeq) productResults.value = page.data
    }
    catch {
      if (seq === searchSeq) productResults.value = []
    }
    finally {
      if (seq === searchSeq) searching.value = false
    }
  }, 300)
})

function addProduct(product: SearchProduct) {
  if (products.value.length >= MAX_PRODUCTS) return
  if (products.value.some(row => row.id === product.id)) return
  products.value.push({
    id: product.id,
    name: product.name,
    slug: product.slug,
    status: product.status,
    priceValue: product.priceValue,
    image: product.images?.[0]?.url ?? null,
    shown: product.status === 'PUBLISHED' && product.priceValue !== null,
  })
}

const pickedProductIds = computed(() => new Set(products.value.map(row => row.id)))
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="Витрина"
      description="Полоса категорий под шапкой на всех страницах и блок «Выбирают покупатели» на главной"
    />

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>
    <UiSkeleton v-else-if="loading" height="420px" radius="var(--radius-md)" />

    <template v-else>
      <!-- Header strip -->
      <UiCard>
        <div class="section-head">
          <div>
            <h2>Популярные категории</h2>
            <p class="admin-muted">
              Полоса под шапкой на всех страницах, в этом порядке; первые четыре — ещё и «Популярное:» под поиском на главной.
              Пусто — первые {{ 7 }} корневых категорий, как раньше.
            </p>
          </div>
          <span class="counter">{{ categories.length }} / {{ MAX_CATEGORIES }}</span>
        </div>

        <ol v-if="categories.length" class="pick-list">
          <li v-for="(row, index) in categories" :key="row.categoryId" class="pick" :class="{ 'is-off': !row.shown }">
            <span class="pick-order">{{ index + 1 }}</span>
            <div class="pick-body">
              <div class="pick-name">
                <strong :class="{ accent: row.highlight }">{{ row.label?.trim() || row.name || 'Категория удалена' }}</strong>
                <span v-if="row.label?.trim() && row.name" class="admin-muted">({{ row.name }})</span>
              </div>
              <div class="pick-meta admin-muted">
                <span v-if="categoryPath(row.categoryId)">{{ categoryPath(row.categoryId) }}</span>
                <span v-if="!row.shown" class="warn">не показывается: скрыта или в ней нет товаров</span>
                <span v-else-if="row.productCount">{{ row.productCount }} товаров</span>
              </div>
              <div class="pick-controls">
                <UiInput v-model="row.label!" size="sm" :placeholder="`Подпись (по умолчанию «${row.name ?? ''}»)`" maxlength="40" />
                <UiCheckbox v-model="row.highlight" label="Выделить" />
              </div>
            </div>
            <div class="pick-actions">
              <UiButton variant="ghost" size="sm" icon-only :disabled="index === 0" aria-label="Выше" @click="move(categories, index, -1)">↑</UiButton>
              <UiButton variant="ghost" size="sm" icon-only :disabled="index === categories.length - 1" aria-label="Ниже" @click="move(categories, index, 1)">↓</UiButton>
              <UiButton variant="ghost" size="sm" icon-only aria-label="Убрать" @click="categories.splice(index, 1)">✕</UiButton>
            </div>
          </li>
        </ol>
        <UiEmpty v-else title="Подборки нет" description="Сейчас в полосе первые корневые категории каталога." />

        <div class="add-row">
          <UiSelect
            v-model="categoryToAdd"
            :options="categoryOptions"
            placeholder="Добавить категорию любого уровня…"
            :disabled="categories.length >= MAX_CATEGORIES"
          />
          <UiButton variant="secondary" :disabled="!categoryToAdd" @click="addCategory">Добавить</UiButton>
        </div>
      </UiCard>

      <!-- Popular products -->
      <UiCard>
        <div class="section-head">
          <div>
            <h2>Популярные товары</h2>
            <p class="admin-muted">
              Блок «Выбирают покупатели» на главной, в этом порядке. Снятые с продажи и без цены не показываются.
              Пусто — товары с лучшими отзывами, как раньше.
            </p>
          </div>
          <span class="counter">{{ products.length }} / {{ MAX_PRODUCTS }}</span>
        </div>

        <ol v-if="products.length" class="pick-list">
          <li v-for="(row, index) in products" :key="row.id" class="pick" :class="{ 'is-off': !row.shown }">
            <span class="pick-order">{{ index + 1 }}</span>
            <span class="pick-thumb">
              <img v-if="row.image" :src="mediaSrc(row.image, 48, 2)" alt="" loading="lazy">
            </span>
            <div class="pick-body">
              <div class="pick-name">
                <NuxtLink v-if="row.slug" :to="`/product/${row.slug}`" target="_blank">{{ row.name }}</NuxtLink>
                <strong v-else>Товар удалён</strong>
              </div>
              <div class="pick-meta admin-muted">
                <span v-if="row.priceValue !== null">{{ formatPrice(row.priceValue) }}</span>
                <span v-if="!row.shown" class="warn">не показывается: не опубликован или без цены</span>
              </div>
            </div>
            <div class="pick-actions">
              <UiButton variant="ghost" size="sm" icon-only :disabled="index === 0" aria-label="Выше" @click="move(products, index, -1)">↑</UiButton>
              <UiButton variant="ghost" size="sm" icon-only :disabled="index === products.length - 1" aria-label="Ниже" @click="move(products, index, 1)">↓</UiButton>
              <UiButton variant="ghost" size="sm" icon-only aria-label="Убрать" @click="products.splice(index, 1)">✕</UiButton>
            </div>
          </li>
        </ol>
        <UiEmpty v-else title="Подборки нет" description="Сейчас в блоке товары с лучшими отзывами." />

        <div class="product-search">
          <UiInput
            v-model="productQuery"
            placeholder="Найти товар по названию, чтобы добавить…"
            :disabled="products.length >= MAX_PRODUCTS"
          />
          <ul v-if="productResults.length" class="results">
            <li v-for="product in productResults" :key="product.id">
              <span class="pick-thumb">
                <img v-if="product.images?.[0]?.url" :src="mediaSrc(product.images[0].url, 48, 2)" alt="" loading="lazy">
              </span>
              <span class="result-name">{{ product.name }}</span>
              <span class="admin-muted">{{ product.priceValue !== null ? formatPrice(product.priceValue) : 'без цены' }}</span>
              <UiButton
                size="sm"
                variant="secondary"
                :disabled="pickedProductIds.has(product.id) || products.length >= MAX_PRODUCTS"
                @click="addProduct(product)"
              >
                {{ pickedProductIds.has(product.id) ? 'Уже в списке' : 'Добавить' }}
              </UiButton>
            </li>
          </ul>
          <p v-else-if="searching" class="admin-muted">Ищем…</p>
          <p v-else-if="productQuery.trim().length >= 2" class="admin-muted">Ничего не нашлось среди опубликованных</p>
        </div>
      </UiCard>

      <div class="save-bar">
        <span v-if="dirty" class="admin-muted">Есть несохранённые изменения</span>
        <UiButton :loading="busy === 'save'" :disabled="!dirty" @click="save">Сохранить витрину</UiButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.section-head {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.section-head h2 {
  margin: 0 0 var(--space-1);
  font-size: var(--text-lg);
}

.section-head p {
  margin: 0;
}

.counter {
  flex: none;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.pick-list {
  display: grid;
  gap: var(--space-2);
  margin: 0 0 var(--space-4);
  padding: 0;
  list-style: none;
}

.pick {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
}

.pick.is-off {
  background: var(--surface-sunken);
}

.pick-order {
  flex: none;
  width: 24px;
  color: var(--text-muted);
  font-weight: 700;
  text-align: right;
}

.pick-thumb {
  display: block;
  flex: none;
  width: 48px;
  height: 48px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: #fff;
}

.pick-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pick-body {
  display: grid;
  flex: 1;
  gap: var(--space-1);
  min-width: 0;
}

.pick-name .accent {
  color: var(--brand);
}

.pick-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
}

.warn {
  color: var(--danger-soft-text);
}

.pick-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  margin-top: var(--space-1);
}

.pick-controls > :first-child {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}

.pick-actions {
  display: flex;
  flex: none;
  gap: var(--space-1);
}

.add-row {
  display: flex;
  gap: var(--space-2);
}

.add-row > :first-child {
  flex: 1;
  min-width: 0;
}

.product-search {
  display: grid;
  gap: var(--space-2);
}

.results {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.results li {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
}

.results li:hover {
  background: var(--surface-hover);
}

.result-name {
  flex: 1;
  min-width: 0;
}

.save-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: var(--space-3);
  align-items: center;
  justify-content: flex-end;
  padding: var(--space-3) 0;
  background: var(--surface-page);
}

@media (max-width: 640px) {
  .pick {
    flex-wrap: wrap;
  }

  .add-row {
    flex-direction: column;
  }
}
</style>
