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

/**
 * Grid or dense list. Kept in localStorage rather than the URL: it's a personal
 * viewing preference, not part of what the page shows, so it shouldn't end up
 * in shared links or split the ISR cache.
 */
const viewMode = useState<'grid' | 'list'>('catalog-view', () => 'grid')
onMounted(() => {
  const saved = localStorage.getItem('catalog-view')
  if (saved === 'grid' || saved === 'list') viewMode.value = saved
})
function setViewMode(mode: 'grid' | 'list') {
  viewMode.value = mode
  if (import.meta.client) localStorage.setItem('catalog-view', mode)
}

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

const breadcrumbItems = computed(() => {
  const items: Array<{ label: string, to?: string }> = [{ label: 'Главная', to: '/' }]
  if (!category.value) {
    items.push({ label: 'Каталог' })
    return items
  }
  items.push({ label: 'Каталог', to: '/catalog/' })
  for (const ancestor of category.value.ancestors) {
    items.push({ label: ancestor.name, to: `/catalog/${ancestor.slug}` })
  }
  items.push({ label: category.value.name })
  return items
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
  <div class="catalog-page">
    <UiBreadcrumbs :items="breadcrumbItems" />

    <header class="catalog-head">
      <h1>{{ category?.name || 'Каталог товаров' }}</h1>
      <p v-if="category?.description">{{ category.description }}</p>
    </header>

    <!-- Subcategory shortcuts: the fastest way to narrow down, so they sit
         above the fold rather than only inside the filter panel. -->
    <nav v-if="categoryLinks.length" class="subcategories" aria-label="Подкатегории">
      <NuxtLink
        v-for="item in categoryLinks"
        :key="item.id"
        :to="categoryTo(item.slug)"
        class="subcategory"
      >
        {{ item.name }}
        <small>{{ item.count }}</small>
      </NuxtLink>
    </nav>

    <div class="layout">
      <UiDrawer v-model:open="filtersOpen" title="Фильтры">
        <CatalogFilters
          v-model:brand-query="brandQuery"
          v-model:price-min="priceDraft.min"
          v-model:price-max="priceDraft.max"
          :category="category"
          :category-links="categoryLinks"
          :parent-link="parentLink"
          :in-stock="inStock"
          :on-sale="onSale"
          :price-range="priceRange"
          :brands="brands"
          :visible-brands="visibleBrands"
          :brand-counts="brandCounts"
          :selected-brand-ids="selectedBrandIds"
          :sources="sources"
          :source-counts="sourceCounts"
          :selected-source="selectedSource"
          :active-filters-count="activeFiltersCount"
          :category-to="categoryTo"
          @push-query="pushQuery"
          @toggle-brand="toggleBrand"
          @toggle-source="toggleSource"
          @apply-price="applyPrice"
          @clear="clearFilters"
        />
        <template #footer>
          <UiButton block @click="filtersOpen = false">
            Показать {{ products?.pagination.total || 0 }}
          </UiButton>
        </template>
      </UiDrawer>

      <aside class="filters-desktop" aria-label="Фильтры каталога">
        <CatalogFilters
          v-model:brand-query="brandQuery"
          v-model:price-min="priceDraft.min"
          v-model:price-max="priceDraft.max"
          :category="category"
          :category-links="categoryLinks"
          :parent-link="parentLink"
          :in-stock="inStock"
          :on-sale="onSale"
          :price-range="priceRange"
          :brands="brands"
          :visible-brands="visibleBrands"
          :brand-counts="brandCounts"
          :selected-brand-ids="selectedBrandIds"
          :sources="sources"
          :source-counts="sourceCounts"
          :selected-source="selectedSource"
          :active-filters-count="activeFiltersCount"
          :category-to="categoryTo"
          @push-query="pushQuery"
          @toggle-brand="toggleBrand"
          @toggle-source="toggleSource"
          @apply-price="applyPrice"
          @clear="clearFilters"
        />
      </aside>

      <div class="content">
        <div class="toolbar">
          <span class="total" aria-live="polite">
            Найдено <strong>{{ products?.pagination.total || 0 }}</strong>
          </span>

          <div class="toolbar-actions">
            <UiButton
              class="filters-toggle"
              variant="secondary"
              size="sm"
              @click="filtersOpen = true"
            >
              Фильтры<template v-if="activeFiltersCount"> · {{ activeFiltersCount }}</template>
            </UiButton>

            <UiSelect
              :model-value="sort"
              size="sm"
              class="sort"
              :options="SORT_OPTIONS"
              @update:model-value="setSort(String($event))"
            />

            <div class="view-switch" role="group" aria-label="Вид списка">
              <button
                type="button"
                :class="{ 'is-active': viewMode === 'grid' }"
                :aria-pressed="viewMode === 'grid'"
                aria-label="Плиткой"
                @click="setViewMode('grid')"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="currentColor" />
                </svg>
              </button>
              <button
                type="button"
                :class="{ 'is-active': viewMode === 'list' }"
                :aria-pressed="viewMode === 'list'"
                aria-label="Списком"
                @click="setViewMode('list')"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5h16M4 12h16M4 19h16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div v-if="filterChips.length" class="chips">
          <button
            v-for="chip in filterChips"
            :key="chip.key"
            type="button"
            class="chip"
            @click="chip.remove()"
          >
            {{ chip.label }}
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
          <button type="button" class="chip is-clear" @click="clearFilters">Сбросить всё</button>
        </div>

        <div v-if="pending" :class="viewMode === 'grid' ? 'grid' : 'list'">
          <UiSkeleton
            v-for="i in 8"
            :key="i"
            :height="viewMode === 'grid' ? '330px' : '180px'"
            radius="var(--radius-md)"
          />
        </div>

        <UiAlert v-else-if="error" tone="danger">
          Не удалось получить товары. Обновите страницу или попробуйте позже.
        </UiAlert>

        <UiEmpty
          v-else-if="!products?.data.length"
          icon="search"
          title="По выбранным фильтрам ничего не найдено"
          description="Попробуйте изменить запрос, расширить диапазон цены или снять часть фильтров."
        >
          <UiButton variant="secondary" @click="clearFilters">Сбросить фильтры</UiButton>
        </UiEmpty>

        <template v-else>
          <div v-if="viewMode === 'grid'" class="grid">
            <ProductCatalogCard
              v-for="product in products.data"
              :key="product.id"
              :product="product"
            />
          </div>
          <div v-else class="list">
            <ProductCatalogRow
              v-for="product in products.data"
              :key="product.id"
              :product="product"
            />
          </div>
        </template>

        <UiPagination
          :page="page"
          :pages="products?.pagination.pages || 0"
          :total="products?.pagination.total"
          @change="setPage"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.catalog-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.catalog-head h1 {
  font-size: var(--text-2xl);
}

.catalog-head p {
  max-width: 80ch;
  margin-top: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* ---- Subcategories ---- */
.subcategories {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.subcategory {
  display: inline-flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-default);
  font-size: var(--text-sm);
  gap: var(--space-2);
}

.subcategory:hover {
  border-color: var(--brand);
  color: var(--brand);
}

.subcategory small {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

/* ---- Layout ---- */
.layout {
  display: grid;
  align-items: start;
  gap: var(--space-5);
  grid-template-columns: 260px minmax(0, 1fr);
}

.filters-desktop {
  position: sticky;
  top: calc(var(--header-height) + var(--space-4));
  max-height: calc(100vh - var(--header-height) - var(--space-8));
  overflow-y: auto;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-4);
}

/* ---- Toolbar ---- */
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-3);
}

.total {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.total strong {
  color: var(--text-strong);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.sort {
  width: 210px;
}

.filters-toggle {
  display: none;
}

.view-switch {
  display: flex;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.view-switch button {
  display: grid;
  width: 34px;
  height: 34px;
  color: var(--text-muted);
  place-items: center;
}

.view-switch button:hover {
  background: var(--surface-hover);
}

.view-switch button.is-active {
  background: var(--brand);
  color: var(--text-inverse);
}

.view-switch svg {
  width: 16px;
  height: 16px;
}

/* ---- Chips ---- */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--brand-soft);
  color: var(--brand-soft-text);
  font-size: var(--text-xs);
  font-weight: 600;
  gap: var(--space-2);
}

.chip svg {
  width: 12px;
  height: 12px;
}

.chip:hover {
  background: var(--brand);
  color: var(--text-inverse);
}

.chip.is-clear {
  background: none;
  color: var(--text-muted);
}

.chip.is-clear:hover {
  background: var(--surface-active);
  color: var(--text-strong);
}

/* ---- Results ---- */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(228px, 1fr));
  gap: var(--space-4);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* ---- Responsive ---- */
@media (max-width: 1024px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .filters-desktop {
    display: none;
  }

  .filters-toggle {
    display: inline-flex;
  }
}

@media (max-width: 560px) {
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .toolbar-actions {
    justify-content: space-between;
  }

  .sort {
    flex: 1;
  }
}
</style>
