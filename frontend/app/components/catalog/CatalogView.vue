<script setup lang="ts">
import ProductCatalogCard from '~/components/product/productCatalogCard.vue'

type FacetItem = {
  id: string
  name: string
  slug?: string
  code?: string
  _count?: { products: number }
}

type CategoryTreeNode = {
  id: string
  name: string
  slug: string
  productCount: number
  children: CategoryTreeNode[]
}

type CategoryPage = {
  id: string
  name: string
  slug: string
  description?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  productCount: number
  ancestors: Array<{ id: string, name: string, slug: string }>
  children: Array<{ id: string, name: string, slug: string, productCount: number }>
}

type Product = {
  id: string
  slug: string
  name: string
  sku?: string | null
  priceValue?: number | null
  priceCurrency?: string | null
  stockStatus?: string | null
  brand?: FacetItem | null
  category?: FacetItem | null
  images?: Array<{ url: string, alt?: string | null }>
  productSpecs?: Array<{ name: string, value: string }>
}

type ProductResponse = {
  data: Product[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
  facets?: {
    categories?: Record<string, number>
    brands?: Record<string, number>
    sources?: Record<string, number>
    priceRange?: { min: number, max: number } | null
  }
}

const props = defineProps<{ categorySlug?: string }>()

const PAGE_SIZE = 24
// 'default' не шлёт sortBy: при активном поиске бэкенд сортирует по
// релевантности, без поиска — по названию
const SORT_OPTIONS = [
  { value: 'default', label: 'По умолчанию' },
  { value: 'price-asc', label: 'Сначала дешевле' },
  { value: 'price-desc', label: 'Сначала дороже' },
  { value: 'new', label: 'Сначала новые' },
  { value: 'rating-desc', label: 'По рейтингу' },
  { value: 'name-asc', label: 'По названию (А-Я)' },
  { value: 'name-desc', label: 'По названию (Я-А)' }
]

const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

function queryValue(value: unknown) {
  if (Array.isArray(value)) return value[0] ? String(value[0]) : undefined
  return value ? String(value) : undefined
}

const cleanParams = (params: Record<string, string | number | boolean | undefined>) => {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== '' && value !== false)
  )
}

// --- filter state derived from the URL (URL is the source of truth) ---
const search = computed(() => queryValue(route.query.search) || '')
const selectedBrandIds = computed(() => {
  const raw = queryValue(route.query.brands) || queryValue(route.query.brandId) || ''
  return raw.split(',').map(id => id.trim()).filter(Boolean)
})
const selectedSource = computed(
  () => queryValue(route.query.source) || queryValue(route.query.sourceCode) || ''
)
const priceMin = computed(() => queryValue(route.query.priceMin) || '')
const priceMax = computed(() => queryValue(route.query.priceMax) || '')
const inStock = computed(() => queryValue(route.query.inStock) === '1')
const onSale = computed(() => queryValue(route.query.onSale) === '1')
const sort = computed(() => queryValue(route.query.sort) || 'default')
const page = computed(() => Math.max(1, Number(queryValue(route.query.page)) || 1))
const legacyCategoryId = computed(() => queryValue(route.query.categoryId))

// price inputs are the only "draft" inputs (applied on submit)
const priceDraft = reactive({ min: priceMin.value, max: priceMax.value })
watch([priceMin, priceMax], ([min, max]) => {
  priceDraft.min = min
  priceDraft.max = max
})

const sortParams = computed(() => {
  if (sort.value === 'default') return { sortBy: undefined, sortOrder: undefined }
  if (sort.value === 'new') return { sortBy: 'createdAt', sortOrder: 'desc' }
  const [sortBy, sortOrder] = sort.value.split('-')
  return { sortBy, sortOrder }
})

const queryParams = computed(() => cleanParams({
  search: search.value || undefined,
  categorySlug: props.categorySlug,
  categoryId: props.categorySlug ? undefined : legacyCategoryId.value,
  brandId: selectedBrandIds.value.join(',') || undefined,
  sourceCode: selectedSource.value || undefined,
  priceMin: priceMin.value || undefined,
  priceMax: priceMax.value || undefined,
  inStock: inStock.value ? '1' : undefined,
  onSale: onSale.value ? '1' : undefined,
  sortBy: sortParams.value.sortBy,
  sortOrder: sortParams.value.sortOrder,
  page: page.value,
  limit: PAGE_SIZE
}))

// --- data ---
const { data: category } = await useAsyncData<CategoryPage | null>(
  () => `catalog-category:${props.categorySlug || ''}`,
  () => props.categorySlug
    ? $fetch<CategoryPage>(`${apiBase}/categories/${props.categorySlug}`)
    : Promise.resolve(null),
  { default: () => null }
)

if (props.categorySlug && !category.value) {
  throw createError({ statusCode: 404, statusMessage: 'Категория не найдена', fatal: true })
}

const catalogDataKey = computed(() => `catalog-products:${route.fullPath}`)
const { data: products, pending, error } = await useAsyncData<ProductResponse>(
  catalogDataKey,
  () => $fetch(`${apiBase}/products`, { params: queryParams.value }),
  {
    default: () => ({ data: [], pagination: { page: 1, limit: PAGE_SIZE, total: 0, pages: 0 } }),
    watch: [queryParams]
  }
)

const { data: tree } = await useAsyncData<CategoryTreeNode[]>(
  'catalog-tree',
  () => $fetch<CategoryTreeNode[]>(`${apiBase}/categories/tree`).catch(() => []),
  { default: () => [] }
)

const { data: brands } = await useAsyncData<FacetItem[]>(
  'catalog-brands',
  () => $fetch<FacetItem[]>(`${apiBase}/brands`).catch(() => []),
  { default: () => [] }
)

const { data: sources } = await useAsyncData<FacetItem[]>(
  'catalog-sources',
  () => $fetch<FacetItem[]>(`${apiBase}/sources`).catch(() => []),
  { default: () => [] }
)

// --- facet helpers ---
const brandCounts = computed(() => products.value?.facets?.brands || {})
const sourceCounts = computed(() => products.value?.facets?.sources || {})
const categoryFacet = computed(() => products.value?.facets?.categories || {})
const priceRange = computed(() => products.value?.facets?.priceRange || null)

const treeNodeBySlug = computed(() => {
  const map = new Map<string, CategoryTreeNode>()
  const walk = (nodes: CategoryTreeNode[]) => {
    for (const node of nodes) {
      map.set(node.slug, node)
      walk(node.children)
    }
  }
  walk(tree.value || [])
  return map
})

/** Subtree product count within the current filter context (facet counts are per leaf category). */
function contextCount(slug: string) {
  const node = treeNodeBySlug.value.get(slug)
  if (!node) return 0
  let sum = 0
  const walk = (item: CategoryTreeNode) => {
    sum += categoryFacet.value[item.id] || 0
    item.children.forEach(walk)
  }
  walk(node)
  return sum
}

const categoryLinks = computed(() => {
  const items = category.value
    ? category.value.children
    : (tree.value || []).map(node => ({ id: node.id, name: node.name, slug: node.slug, productCount: node.productCount }))
  return items.map(item => ({
    ...item,
    count: contextCount(item.slug)
  }))
})

const parentLink = computed(() => {
  if (!category.value) return null
  const parent = category.value.ancestors.at(-1)
  return parent
    ? { to: categoryTo(parent.slug), label: parent.name }
    : { to: categoryTo(null), label: 'Все категории' }
})

// brand search inside the facet
const brandQuery = ref('')
const visibleBrands = computed(() => {
  const list = (brands.value || [])
    .filter(brand => (brandCounts.value[brand.id] || 0) > 0 || selectedBrandIds.value.includes(brand.id))
  const query = brandQuery.value.trim().toLowerCase()
  return query ? list.filter(brand => brand.name.toLowerCase().includes(query)) : list
})

const selectedBrands = computed(() =>
  (brands.value || []).filter(brand => selectedBrandIds.value.includes(brand.id))
)

// --- navigation ---
function currentQuery(overrides: Record<string, string | undefined>) {
  return cleanParams({
    search: search.value || undefined,
    brands: selectedBrandIds.value.join(',') || undefined,
    source: selectedSource.value || undefined,
    priceMin: priceMin.value || undefined,
    priceMax: priceMax.value || undefined,
    inStock: inStock.value ? '1' : undefined,
    onSale: onSale.value ? '1' : undefined,
    sort: sort.value === 'default' ? undefined : sort.value,
    ...overrides
  })
}

function pushQuery(overrides: Record<string, string | undefined>) {
  // any filter change resets pagination
  router.push({ path: route.path, query: currentQuery({ page: undefined, ...overrides }) })
}

function categoryTo(slug: string | null) {
  return {
    path: slug ? `/catalog/${slug}` : '/catalog/',
    query: currentQuery({ page: undefined })
  }
}

function toggleBrand(id: string) {
  const next = selectedBrandIds.value.includes(id)
    ? selectedBrandIds.value.filter(item => item !== id)
    : [...selectedBrandIds.value, id]
  pushQuery({ brands: next.join(',') || undefined })
}

function toggleSource(code?: string) {
  if (!code) return
  pushQuery({ source: selectedSource.value === code ? undefined : code })
}

function applyPrice() {
  pushQuery({
    priceMin: priceDraft.min ? String(priceDraft.min) : undefined,
    priceMax: priceDraft.max ? String(priceDraft.max) : undefined
  })
}

function setSort(value: string) {
  pushQuery({ sort: value === 'default' ? undefined : value, page: page.value > 1 ? String(page.value) : undefined })
}

function setPage(next: number) {
  router.push({ path: route.path, query: currentQuery({ page: next > 1 ? String(next) : undefined }) })
  if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
}

function clearFilters() {
  router.push({ path: route.path })
}

const activeFiltersCount = computed(() =>
  (search.value ? 1 : 0)
  + selectedBrandIds.value.length
  + (selectedSource.value ? 1 : 0)
  + ((priceMin.value || priceMax.value) ? 1 : 0)
  + (inStock.value ? 1 : 0)
  + (onSale.value ? 1 : 0)
)

type Chip = { key: string, label: string, remove: () => void }
const filterChips = computed<Chip[]>(() => {
  const chips: Chip[] = []
  if (search.value) {
    chips.push({ key: 'search', label: `Поиск: ${search.value}`, remove: () => pushQuery({ search: undefined }) })
  }
  for (const brand of selectedBrands.value) {
    chips.push({
      key: `brand-${brand.id}`,
      label: brand.name,
      remove: () => toggleBrand(brand.id)
    })
  }
  if (selectedSource.value) {
    const source = (sources.value || []).find(item => item.code === selectedSource.value)
    chips.push({ key: 'source', label: `Поставщик: ${source?.name || selectedSource.value}`, remove: () => pushQuery({ source: undefined }) })
  }
  if (priceMin.value || priceMax.value) {
    const label = priceMin.value && priceMax.value
      ? `Цена: ${priceMin.value}–${priceMax.value} BYN`
      : priceMin.value ? `Цена от ${priceMin.value} BYN` : `Цена до ${priceMax.value} BYN`
    chips.push({ key: 'price', label, remove: () => pushQuery({ priceMin: undefined, priceMax: undefined }) })
  }
  if (inStock.value) {
    chips.push({ key: 'stock', label: 'В наличии', remove: () => pushQuery({ inStock: undefined }) })
  }
  if (onSale.value) {
    chips.push({ key: 'sale', label: 'Со скидкой', remove: () => pushQuery({ onSale: undefined }) })
  }
  return chips
})

// --- pagination ---
const pageNumbers = computed(() => {
  const total = products.value?.pagination.pages || 0
  if (total <= 1) return []
  const current = page.value
  const numbers = new Set<number>([1, total])
  for (let i = current - 2; i <= current + 2; i++) {
    if (i >= 1 && i <= total) numbers.add(i)
  }
  const sorted = [...numbers].sort((a, b) => a - b)
  const result: Array<number | '...'> = []
  for (let i = 0; i < sorted.length; i++) {
    const value = sorted[i]!
    if (i > 0 && value - (sorted[i - 1] as number) > 1) result.push('...')
    result.push(value)
  }
  return result
})

// --- mobile filters drawer ---
const filtersOpen = ref(false)
watch(() => route.fullPath, () => { filtersOpen.value = false })
watch(filtersOpen, open => {
  if (import.meta.client) document.body.style.overflow = open ? 'hidden' : ''
})
onUnmounted(() => {
  if (import.meta.client) document.body.style.overflow = ''
})

// --- SEO ---
const siteUrl = String(config.public.siteUrl).replace(/\/$/, '')
const pageTitle = computed(() => category.value
  ? `${category.value.name} — купить в каталоге | Мультитул`
  : 'Каталог инструмента и крепежа | Мультитул')
const pageDescription = computed(() => category.value
  ? (category.value.seoDescription || `${category.value.name}: ${category.value.productCount} товаров в каталоге Мультитул. Фильтры по брендам и цене, доставка по Беларуси.`)
  : 'Каталог инструментов, крепежа и расходников с фильтрами по категориям, брендам и цене.')
const canonicalUrl = computed(() => category.value
  ? `${siteUrl}/catalog/${category.value.slug}`
  : `${siteUrl}/catalog`)

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogType: 'website',
  ogUrl: canonicalUrl,
  twitterCard: 'summary'
})

useHead(() => ({
  link: [{ rel: 'canonical', href: canonicalUrl.value }],
  script: category.value
    ? [{
        type: 'application/ld+json',
        innerHTML: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          'itemListElement': [
            { '@type': 'ListItem', 'position': 1, 'name': 'Главная', 'item': `${siteUrl}/` },
            { '@type': 'ListItem', 'position': 2, 'name': 'Каталог', 'item': `${siteUrl}/catalog` },
            ...category.value.ancestors.map((ancestor, index) => ({
              '@type': 'ListItem',
              'position': 3 + index,
              'name': ancestor.name,
              'item': `${siteUrl}/catalog/${ancestor.slug}`
            })),
            {
              '@type': 'ListItem',
              'position': 3 + category.value.ancestors.length,
              'name': category.value.name,
              'item': canonicalUrl.value
            }
          ]
        })
      }]
    : []
}))
</script>

<template>
  <div>
    <nav class="breadcrumbs" aria-label="Хлебные крошки">
      <NuxtLink to="/">Главная</NuxtLink>
      <span aria-hidden="true">/</span>
      <NuxtLink v-if="category" to="/catalog/">Каталог</NuxtLink>
      <strong v-else>Каталог</strong>
      <template v-for="ancestor in category?.ancestors || []" :key="ancestor.id">
        <span aria-hidden="true">/</span>
        <NuxtLink :to="`/catalog/${ancestor.slug}`">{{ ancestor.name }}</NuxtLink>
      </template>
      <template v-if="category">
        <span aria-hidden="true">/</span>
        <strong>{{ category.name }}</strong>
      </template>
    </nav>

    <header class="catalog-head">
      <h1>{{ category?.name || 'Каталог товаров' }}</h1>
      <p v-if="category?.description">{{ category.description }}</p>
    </header>

    <div v-if="categoryLinks.length" class="subcategories" aria-label="Подкатегории">
      <NuxtLink
        v-for="item in categoryLinks"
        :key="item.id"
        :to="categoryTo(item.slug)"
        class="subcategory-chip"
      >
        {{ item.name }}
        <small>{{ item.count }}</small>
      </NuxtLink>
    </div>

    <section class="catalog-layout">
      <div
        v-if="filtersOpen"
        class="filters-backdrop"
        aria-hidden="true"
        @click="filtersOpen = false"
      />

      <aside class="filters-panel" :class="{ open: filtersOpen }" aria-label="Фильтры каталога">
        <div class="filters-head">
          <h2>Фильтры</h2>
          <button
            v-if="activeFiltersCount"
            class="ghost-button"
            type="button"
            @click="clearFilters"
          >
            Сбросить ({{ activeFiltersCount }})
          </button>
          <button class="close-filters" type="button" aria-label="Закрыть фильтры" @click="filtersOpen = false">
            ✕
          </button>
        </div>

        <div class="filter-section">
          <div class="filter-title">Категории</div>
          <NuxtLink v-if="parentLink" :to="parentLink.to" class="parent-link">
            ← {{ parentLink.label }}
          </NuxtLink>
          <div v-if="categoryLinks.length" class="facet-list">
            <NuxtLink
              v-for="item in categoryLinks"
              :key="item.id"
              :to="categoryTo(item.slug)"
              class="facet-link"
            >
              <span>{{ item.name }}</span>
              <small class="facet-count">{{ item.count }}</small>
            </NuxtLink>
          </div>
          <p v-else-if="category" class="facet-empty">Это конечная категория.</p>
        </div>

        <div class="filter-section">
          <label class="check-row">
            <input
              type="checkbox"
              :checked="inStock"
              @change="pushQuery({ inStock: inStock ? undefined : '1' })"
            >
            <span>Только в наличии</span>
          </label>
          <label class="check-row">
            <input
              type="checkbox"
              :checked="onSale"
              @change="pushQuery({ onSale: onSale ? undefined : '1' })"
            >
            <span>Только со скидкой</span>
          </label>
        </div>

        <div class="filter-section">
          <div class="filter-title">Цена, BYN</div>
          <form class="price-grid" @submit.prevent="applyPrice">
            <input
              v-model.trim="priceDraft.min"
              type="number"
              min="0"
              inputmode="numeric"
              :placeholder="priceRange ? `от ${priceRange.min}` : 'от'"
              aria-label="Цена от"
            >
            <input
              v-model.trim="priceDraft.max"
              type="number"
              min="0"
              inputmode="numeric"
              :placeholder="priceRange ? `до ${priceRange.max}` : 'до'"
              aria-label="Цена до"
            >
            <button type="submit">OK</button>
          </form>
        </div>

        <div class="filter-section">
          <div class="filter-title">
            Бренды
            <small v-if="selectedBrandIds.length">{{ selectedBrandIds.length }}</small>
          </div>
          <input
            v-if="(brands?.length || 0) > 8"
            v-model.trim="brandQuery"
            type="search"
            class="facet-search"
            placeholder="Найти бренд"
          >
          <div class="facet-list">
            <label v-for="brand in visibleBrands" :key="brand.id" class="check-row">
              <input
                type="checkbox"
                :checked="selectedBrandIds.includes(brand.id)"
                @change="toggleBrand(brand.id)"
              >
              <span>{{ brand.name }}</span>
              <small class="facet-count">{{ brandCounts[brand.id] || 0 }}</small>
            </label>
            <p v-if="!visibleBrands.length" class="facet-empty">Нет брендов по запросу.</p>
          </div>
        </div>

        <div v-if="(sources?.length || 0) > 1" class="filter-section">
          <div class="filter-title">Поставщики</div>
          <div class="facet-list">
            <button
              v-for="source in sources || []"
              :key="source.id"
              type="button"
              class="facet-link"
              :class="{ active: selectedSource === source.code }"
              :aria-pressed="selectedSource === source.code"
              :disabled="!source.code"
              @click="toggleSource(source.code)"
            >
              <span>{{ source.name }}</span>
              <small class="facet-count">{{ sourceCounts[source.id] || 0 }}</small>
            </button>
          </div>
        </div>

        <button class="apply-button" type="button" @click="filtersOpen = false">
          Показать {{ products?.pagination.total || 0 }} товаров
        </button>
      </aside>

      <div class="catalog-content">
        <div class="catalog-toolbar">
          <span class="total" aria-live="polite">
            Найдено: <strong>{{ products?.pagination.total || 0 }}</strong>
          </span>

          <div class="toolbar-actions">
            <button class="filters-toggle" type="button" @click="filtersOpen = true">
              Фильтры
              <small v-if="activeFiltersCount">{{ activeFiltersCount }}</small>
            </button>
            <label class="sort-field">
              <span>Сортировка</span>
              <select :value="sort" @change="setSort(($event.target as HTMLSelectElement).value)">
                <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>
        </div>

        <div v-if="filterChips.length" class="filter-chips">
          <button
            v-for="chip in filterChips"
            :key="chip.key"
            type="button"
            class="chip"
            @click="chip.remove()"
          >
            {{ chip.label }} <span aria-hidden="true">✕</span>
          </button>
          <button type="button" class="chip clear" @click="clearFilters">Сбросить всё</button>
        </div>

        <div v-if="pending" class="state-card">Загружаем каталог...</div>
        <div v-else-if="error" class="state-card error">
          Не удалось получить товары. Обновите страницу или попробуйте позже.
        </div>
        <div v-else-if="!products?.data.length" class="state-card">
          По выбранным фильтрам ничего не найдено. Попробуйте изменить запрос или
          <button type="button" class="inline-link" @click="clearFilters">сбросить фильтры</button>.
        </div>
        <div v-else class="products-listing">
          <ProductCatalogCard
            v-for="product in products.data"
            :key="product.id"
            :product="product"
          />
        </div>

        <nav
          v-if="pageNumbers.length"
          class="pagination"
          aria-label="Страницы каталога"
        >
          <button
            type="button"
            :disabled="page <= 1"
            aria-label="Предыдущая страница"
            @click="setPage(page - 1)"
          >
            ←
          </button>
          <template v-for="(item, index) in pageNumbers" :key="`${item}-${index}`">
            <span v-if="item === '...'" class="dots">…</span>
            <button
              v-else
              type="button"
              :class="{ current: item === page }"
              :aria-current="item === page ? 'page' : undefined"
              @click="setPage(item as number)"
            >
              {{ item }}
            </button>
          </template>
          <button
            type="button"
            :disabled="page >= (products?.pagination.pages || 1)"
            aria-label="Следующая страница"
            @click="setPage(page + 1)"
          >
            →
          </button>
        </nav>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 600;

  a {
    color: inherit;
    text-decoration: none;

    &:hover {
      color: var(--color-primary);
    }
  }

  strong {
    color: #101828;
  }
}

.catalog-head {
  margin-bottom: 16px;

  h1 {
    font-size: clamp(26px, 4vw, 38px);
    line-height: 1.1;
  }

  p {
    max-width: 760px;
    margin-top: 8px;
    color: var(--color-muted);
    line-height: 1.6;
  }
}

.subcategories {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}

.subcategory-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  background: white;
  color: #344054;
  font-size: 14px;
  font-weight: 700;
  padding: 8px 14px;
  text-decoration: none;
  transition: border-color 0.16s ease, color 0.16s ease;

  small {
    border-radius: 999px;
    background: #f2f4f7;
    color: var(--color-muted);
    font-size: 12px;
    padding: 2px 7px;
  }

  &:hover {
    border-color: #c7d7fe;
    color: var(--color-primary);
  }
}

.catalog-layout {
  display: grid;
  gap: 20px;

  @include media-breakpoint-up(lg) {
    grid-template-columns: 280px minmax(0, 1fr);
    align-items: start;
  }
}

.filters-backdrop {
  position: fixed;
  z-index: 39;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);

  @include media-breakpoint-up(lg) {
    display: none;
  }
}

.filters-panel {
  position: fixed;
  z-index: 40;
  top: 0;
  bottom: 0;
  left: 0;
  display: none;
  overflow-y: auto;
  width: min(340px, 92vw);
  background: white;
  padding: 12px 18px 18px;

  &.open {
    display: block;
  }

  @include media-breakpoint-up(lg) {
    position: static;
    display: block;
    overflow: visible;
    width: auto;
    border: 1px solid var(--color-line);
    border-radius: var(--radius-lg);
  }
}

.filters-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--color-line);
  margin-bottom: 4px;
  padding-bottom: 12px;

  h2 {
    font-size: 20px;
  }
}

.close-filters {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: white;
  cursor: pointer;
  font-size: 14px;
  padding: 6px 10px;

  @include media-breakpoint-up(lg) {
    display: none;
  }
}

.ghost-button {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: white;
  color: #344054;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  padding: 6px 10px;
}

.filter-section {
  border-bottom: 1px solid var(--color-line);
  padding: 14px 0;

  &:last-of-type {
    border-bottom: 0;
  }
}

.filter-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  color: #101828;
  font-size: 13px;
  font-weight: 800;

  small {
    border-radius: 999px;
    background: #eef4ff;
    color: var(--color-primary);
    font-size: 11px;
    font-weight: 800;
    padding: 2px 8px;
  }
}

.parent-link {
  display: inline-block;
  margin-bottom: 8px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}

.facet-list {
  display: grid;
  gap: 2px;
}

.facet-link,
.check-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #344054;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  padding: 8px 10px;
  text-align: left;
  text-decoration: none;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover {
    background: #f8fafc;
    color: #101828;
  }

  &.active {
    background: #eef4ff;
    color: var(--color-primary);
  }
}

.check-row {
  grid-template-columns: auto minmax(0, 1fr) auto;

  input {
    width: 16px;
    height: 16px;
    accent-color: var(--color-primary);
  }
}

.facet-count {
  min-width: 28px;
  border-radius: 999px;
  background: #eef2f6;
  color: #667085;
  font-size: 12px;
  font-weight: 700;
  padding: 2px 7px;
  text-align: center;
}

.facet-search {
  width: 100%;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  margin-bottom: 8px;
  outline: 0;
  padding: 9px 11px;

  &:focus {
    border-color: var(--color-primary);
  }
}

.facet-empty {
  color: var(--color-muted);
  font-size: 13px;
}

.price-grid {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;

  input {
    min-width: 0;
    border: 1px solid var(--color-line);
    border-radius: 10px;
    outline: 0;
    padding: 9px 11px;

    &:focus {
      border-color: var(--color-primary);
    }
  }

  button {
    border: 0;
    border-radius: 10px;
    background: var(--color-primary);
    color: white;
    cursor: pointer;
    font-weight: 800;
    padding: 0 14px;
  }
}

.apply-button {
  width: 100%;
  border: 0;
  border-radius: 12px;
  background: var(--color-primary);
  color: white;
  cursor: pointer;
  font-weight: 800;
  margin-top: 14px;
  padding: 13px 14px;

  @include media-breakpoint-up(lg) {
    display: none;
  }
}

.catalog-content {
  display: grid;
  gap: 14px;
}

.catalog-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: white;
  padding: 12px 16px;
}

.total {
  color: var(--color-muted);
  font-size: 14px;

  strong {
    color: #101828;
  }
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.filters-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: white;
  color: #344054;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  padding: 9px 12px;

  small {
    border-radius: 999px;
    background: var(--color-primary);
    color: white;
    font-size: 11px;
    font-weight: 800;
    min-width: 18px;
    padding: 1px 5px;
  }

  @include media-breakpoint-up(lg) {
    display: none;
  }
}

.sort-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;

  span {
    display: none;
    color: var(--color-muted);
    font-size: 13px;
    font-weight: 700;

    @include media-breakpoint-up(md) {
      display: inline;
    }
  }

  select {
    border: 1px solid var(--color-line);
    border-radius: 10px;
    background: white;
    color: #101828;
    font-size: 14px;
    font-weight: 600;
    outline: 0;
    padding: 9px 10px;

    &:focus {
      border-color: var(--color-primary);
    }
  }
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #c7d7fe;
  border-radius: 999px;
  background: #eef4ff;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  padding: 7px 12px;

  span {
    font-size: 11px;
  }

  &.clear {
    border-color: var(--color-line);
    background: white;
    color: var(--color-muted);
  }
}

.state-card {
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: white;
  color: var(--color-muted);
  font-size: 16px;
  font-weight: 600;
  padding: 32px;
}

.state-card.error {
  color: #b42318;
}

.inline-link {
  border: 0;
  background: none;
  color: var(--color-primary);
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-decoration: underline;
}

.products-listing {
  display: grid;
  gap: 16px;

  @include media-breakpoint-up(sm) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @include media-breakpoint-up(lg) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @include media-breakpoint-up(xl) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;

  button {
    min-width: 40px;
    border: 1px solid var(--color-line);
    border-radius: 10px;
    background: white;
    color: #344054;
    cursor: pointer;
    font-weight: 700;
    padding: 9px 10px;

    &:disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }

    &.current {
      border-color: var(--color-primary);
      background: var(--color-primary);
      color: white;
    }
  }

  .dots {
    color: var(--color-muted);
    padding: 0 4px;
  }
}
</style>
