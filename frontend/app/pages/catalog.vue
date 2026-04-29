<script setup lang="ts">
import ProductCatalogCard from '~/components/product/productCatalogCard.vue'

type FacetItem = {
  id: string
  name: string
  slug?: string
}

type Product = {
  id: string
  slug: string
  name: string
  priceValue?: number | null
  priceCurrency?: string | null
  brandId?: string | null
  categoryId: string
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
}

const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

function queryValue(value: unknown) {
  if (Array.isArray(value)) return value[0]
  return value ? String(value) : undefined
}

const filterValue = (value: string | number) => value === '' ? undefined : String(value)
const cleanParams = (params: Record<string, string | number | undefined>) => {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== '')
  )
}

const filters = reactive<{
  search: string
  categoryId: string
  brandId: string
  priceMin: string | number
  priceMax: string | number
  sort: string
}>({
  search: queryValue(route.query.search) || '',
  categoryId: queryValue(route.query.categoryId) || '',
  brandId: queryValue(route.query.brandId) || '',
  priceMin: queryValue(route.query.priceMin) || '',
  priceMax: queryValue(route.query.priceMax) || '',
  sort: queryValue(route.query.sort) || 'name-asc'
})

const page = computed(() => Number(route.query.page || 1))

const queryParams = computed(() => {
  const sort = queryValue(route.query.sort)

  return cleanParams({
    search: queryValue(route.query.search),
    categoryId: queryValue(route.query.categoryId),
    brandId: queryValue(route.query.brandId),
    priceMin: queryValue(route.query.priceMin),
    priceMax: queryValue(route.query.priceMax),
    sortBy: sort?.split('-')[0],
    sortOrder: sort?.split('-')[1],
    page: page.value,
    limit: 20
  })
})

const { data: products, pending, error, refresh } = await useAsyncData<ProductResponse>(
  'catalog-products',
  () => $fetch(`${apiBase}/products`, { params: queryParams.value }),
  {
    default: () => ({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }),
    watch: [queryParams]
  }
)

const { data: categories } = await useAsyncData<FacetItem[]>(
  'catalog-categories',
  () => $fetch<FacetItem[]>(`${apiBase}/categories`).catch(() => []),
  { default: () => [] }
)

const { data: brands } = await useAsyncData<FacetItem[]>(
  'catalog-brands',
  () => $fetch<FacetItem[]>(`${apiBase}/brands`).catch(() => []),
  { default: () => [] }
)

const { data: facetProducts } = await useAsyncData<ProductResponse>(
  'catalog-facet-products',
  () =>
    $fetch<ProductResponse>(`${apiBase}/products`, { params: { limit: 200 } })
      .catch(() => ({ data: [], pagination: { page: 1, limit: 200, total: 0, pages: 0 } })),
  {
    default: () => ({ data: [], pagination: { page: 1, limit: 200, total: 0, pages: 0 } })
  }
)

const activeFiltersCount = computed(() => {
  return [filters.search, filters.categoryId, filters.brandId, filters.priceMin, filters.priceMax]
    .filter(value => filterValue(value) !== undefined)
    .length
})

const categoryCounts = computed(() => countBy(facetProducts.value?.data || [], 'categoryId'))
const brandCounts = computed(() => countBy(facetProducts.value?.data || [], 'brandId'))
const priceRange = computed(() => {
  const values = (facetProducts.value?.data || [])
    .map(product => product.priceValue)
    .filter((value): value is number => typeof value === 'number')

  if (!values.length) return null

  return {
    min: Math.floor(Math.min(...values)),
    max: Math.ceil(Math.max(...values))
  }
})

const selectedCategory = computed(() => categories.value?.find(item => item.id === filters.categoryId))
const selectedBrand = computed(() => brands.value?.find(item => item.id === filters.brandId))

function countBy(items: Product[], key: 'categoryId' | 'brandId') {
  return items.reduce<Record<string, number>>((acc, item) => {
    const value = item[key]
    if (value) acc[value] = (acc[value] || 0) + 1
    return acc
  }, {})
}

function applyFilters(nextPage = 1) {
  const nextQuery = {
    ...route.query,
    search: filterValue(filters.search),
    categoryId: filters.categoryId || undefined,
    brandId: filters.brandId || undefined,
    priceMin: filterValue(filters.priceMin),
    priceMax: filterValue(filters.priceMax),
    sort: filters.sort === 'name-asc' ? undefined : filters.sort,
    page: nextPage > 1 ? String(nextPage) : undefined
  }

  router.push({ path: '/catalog/', query: nextQuery })
}

function setFacet(key: 'categoryId' | 'brandId', value: string) {
  filters[key] = filters[key] === value ? '' : value
  applyFilters()
}

function clearFilters() {
  filters.search = ''
  filters.categoryId = ''
  filters.brandId = ''
  filters.priceMin = ''
  filters.priceMax = ''
  filters.sort = 'name-asc'
  router.push({ path: '/catalog/' })
}

watch(
  () => route.query,
  query => {
    filters.search = queryValue(query.search) || ''
    filters.categoryId = queryValue(query.categoryId) || ''
    filters.brandId = queryValue(query.brandId) || ''
    filters.priceMin = queryValue(query.priceMin) || ''
    filters.priceMax = queryValue(query.priceMax) || ''
    filters.sort = queryValue(query.sort) || 'name-asc'
  }
)

useHead({
  title: 'Каталог инструмента и крепежа | Мультитул',
  meta: [
    {
      name: 'description',
      content:
        'Каталог инструментов, крепежа и расходников с фильтрами по брендам, категориям и цене.'
    }
  ]
})
</script>

<template>
  <div>
    <section class="catalog-hero">
      <div>
        <span class="eyebrow">Каталог</span>
        <h1>
          Инструмент, крепеж и расходники для стройки без лишней витрины
        </h1>
        <p>
          Поиск подключен к бэку: категории, бренды, цена, сортировка и пагинация
          работают через query-параметры.
        </p>
      </div>

      <form class="hero-search" @submit.prevent="applyFilters()">
        <input
          v-model.trim="filters.search"
          type="search"
          placeholder="Найти перфоратор, сверло, крепеж..."
        >
        <button type="submit">Искать</button>
      </form>
    </section>

    <section class="catalog-layout">
      <aside class="filters-panel" aria-label="Фильтры каталога">
        <div class="filters-head">
        <div>
          <span class="eyebrow">Фасеты</span>
          <h2>Фильтры</h2>
        </div>
        <button v-if="activeFiltersCount" class="ghost-button" type="button" @click="clearFilters">
          Сбросить
        </button>
      </div>

      <form class="filter-form" @submit.prevent="applyFilters()">
        <label class="field">
          <span>Поиск</span>
          <input v-model.trim="filters.search" type="search" placeholder="Название товара">
        </label>

        <div class="filter-group" :class="{ highlighted: route.query.focus === 'brands' }">
          <div class="filter-title">Бренды</div>
          <button
            v-for="brand in brands || []"
            :key="brand.id"
            type="button"
            class="facet-button"
            :class="{ active: filters.brandId === brand.id }"
            @click="setFacet('brandId', brand.id)"
          >
            <span>{{ brand.name }}</span>
            <small>{{ brandCounts[brand.id] || 0 }}</small>
          </button>
        </div>

        <div class="filter-group">
          <div class="filter-title">Категории</div>
          <button
            v-for="category in categories || []"
            :key="category.id"
            type="button"
            class="facet-button"
            :class="{ active: filters.categoryId === category.id }"
            @click="setFacet('categoryId', category.id)"
          >
            <span>{{ category.name }}</span>
            <small>{{ categoryCounts[category.id] || 0 }}</small>
          </button>
        </div>

        <div class="filter-group">
          <div class="filter-title">Цена</div>
          <div v-if="priceRange" class="price-hint">
            В базе: {{ priceRange.min }} - {{ priceRange.max }} BYN
          </div>
          <div class="price-grid">
            <label class="field">
              <span>От</span>
              <input v-model.number="filters.priceMin" type="number" min="0" inputmode="numeric">
            </label>
            <label class="field">
              <span>До</span>
              <input v-model.number="filters.priceMax" type="number" min="0" inputmode="numeric">
            </label>
          </div>
        </div>

        <label class="field">
          <span>Сортировка</span>
          <select v-model="filters.sort">
            <option value="name-asc">Название: А-Я</option>
            <option value="name-desc">Название: Я-А</option>
            <option value="price-asc">Сначала дешевле</option>
            <option value="price-desc">Сначала дороже</option>
          </select>
        </label>

        <button class="apply-button" type="submit">Применить фильтры</button>
      </form>
    </aside>

    <div class="catalog-content">
      <div class="catalog-toolbar">
        <div>
          <span class="eyebrow">Найдено {{ products?.pagination.total || 0 }}</span>
          <h2>
            {{ selectedCategory?.name || selectedBrand?.name || 'Все товары' }}
          </h2>
        </div>
        <button class="refresh-button" type="button" @click="refresh()">
          Обновить
        </button>
      </div>

      <div v-if="pending" class="state-card">Загружаем каталог...</div>
      <div v-else-if="error" class="state-card error">
        Не удалось получить товары: {{ error.message }}
      </div>
      <div v-else-if="!products?.data.length" class="state-card">
        По выбранным фильтрам ничего не найдено. Попробуйте изменить запрос или
        сбросить фильтры.
      </div>
      <div v-else class="products-listing">

        <ProductCatalogCard
          v-for="product in products.data"
          :key="product.id"
          :product="product"
        />

      </div>
      <div v-if="products?.pagination.pages && products.pagination.pages > 1" class="pagination">
        <button
          type="button"
          :disabled="page <= 1"
          @click="applyFilters(page - 1)"
        >
          Назад
        </button>
        <span>Страница {{ page }} из {{ products.pagination.pages }}</span>
        <button
          type="button"
          :disabled="page >= products.pagination.pages"
          @click="applyFilters(page + 1)"
        >
          Вперед
        </button>
      </div>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.catalog-hero {
  display: grid;
  gap: 28px;
  align-items: end;
  margin-bottom: 34px;
  padding: clamp(28px, 5vw, 64px);
  border: 2px solid var(--color-ink);
  border-radius: 38px;
  background:
    linear-gradient(120deg, rgba(255, 250, 240, 0.94), rgba(243, 182, 31, 0.34)),
    radial-gradient(circle at 88% 20%, rgba(222, 77, 47, 0.3), transparent 18rem);
  box-shadow: 12px 12px 0 var(--color-ink);

  @include media-breakpoint-up(lg) {
    grid-template-columns: minmax(0, 1fr) 420px;
  }

  h1 {
    max-width: 850px;
    margin-top: 12px;
    font-size: clamp(34px, 6vw, 72px);
    line-height: 0.98;
  }

  p {
    max-width: 720px;
    margin-top: 18px;
    color: var(--color-muted);
    font-size: 18px;
    line-height: 1.7;
  }
}

.eyebrow {
  color: var(--color-accent-strong);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.hero-search {
  display: flex;
  gap: 10px;
  padding: 8px;
  border: 2px solid var(--color-ink);
  border-radius: 999px;
  background: white;

  input {
    min-width: 0;
    flex: 1;
    border: 0;
    padding: 0 12px;
    outline: 0;
  }

  button {
    border: 0;
    border-radius: 999px;
    background: var(--color-ink);
    color: white;
    cursor: pointer;
    font-weight: 900;
    padding: 13px 18px;
  }
}

.catalog-layout {
  display: grid;
  gap: 28px;

  @include media-breakpoint-up(lg) {
    grid-template-columns: 320px minmax(0, 1fr);
    align-items: start;
  }
}

.filters-panel,
.catalog-toolbar,
.state-card {
  border: 2px solid var(--color-ink);
  border-radius: 30px;
  background: rgba(255, 250, 240, 0.9);
  box-shadow: 7px 7px 0 rgba(22, 28, 45, 0.92);
}

.filters-panel {
  padding: 22px;

  @include media-breakpoint-up(lg) {
    position: sticky;
    top: 108px;
  }
}

.filters-head,
.catalog-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.filters-head h2,
.catalog-toolbar h2 {
  margin-top: 6px;
  font-size: 24px;
}

.filter-form,
.filter-group {
  display: grid;
  gap: 14px;
}

.filter-form {
  margin-top: 22px;
}

.filter-group {
  padding-top: 4px;
  max-height: 250px;
  overflow-y: auto;
}

.filter-group.highlighted {
  margin: -8px;
  padding: 8px;
  border-radius: 20px;
  background: rgba(243, 182, 31, 0.2);
}

.filter-title,
.field span {
  color: var(--color-ink);
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.field {
  display: grid;
  gap: 8px;
}

.field input,
.field select {
  width: 100%;
  border: 1px solid var(--color-line);
  border-radius: 16px;
  background: white;
  color: var(--color-ink);
  outline: 0;
  padding: 13px 14px;

  &:focus {
    border-color: var(--color-ink);
    box-shadow: 0 0 0 3px rgba(243, 182, 31, 0.38);
  }
}

.facet-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: 1px solid var(--color-line);
  border-radius: 16px;
  background: white;
  color: var(--color-ink);
  cursor: pointer;
  font-weight: 800;
  padding: 11px 12px;
  text-align: left;

  small {
    min-width: 28px;
    border-radius: 999px;
    background: rgba(22, 28, 45, 0.08);
    color: var(--color-muted);
    padding: 4px 8px;
    text-align: center;
  }

  &.active {
    border-color: var(--color-ink);
    background: var(--color-accent);
  }
}

.price-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.price-hint {
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}

.apply-button,
.ghost-button,
.refresh-button,
.pagination button {
  border: 2px solid var(--color-ink);
  border-radius: 999px;
  cursor: pointer;
  font-weight: 900;
}

.apply-button {
  background: var(--color-accent);
  box-shadow: 4px 4px 0 var(--color-ink);
  padding: 14px 16px;
}

.ghost-button,
.refresh-button {
  background: white;
  padding: 10px 14px;
}

.catalog-content {
  display: grid;
  gap: 24px;
}

.catalog-toolbar {
  padding: 20px 24px;
}

.products-listing {
  display: grid;
  gap: 26px;

  @include media-breakpoint-up(md) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @include media-breakpoint-up(xl) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.state-card {
  padding: 42px;
  color: var(--color-muted);
  font-size: 18px;
  font-weight: 800;
}

.state-card.error {
  color: var(--color-accent-strong);
}

.pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 10px;

  button {
    background: white;
    padding: 11px 18px;

    &:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }
  }

  span {
    color: var(--color-muted);
    font-weight: 900;
  }
}

@media (max-width: 520px) {
  .catalog-hero {
    border-radius: 28px;
    box-shadow: 7px 7px 0 var(--color-ink);
  }

  .hero-search {
    align-items: stretch;
    flex-direction: column;
    border-radius: 24px;
  }
}
</style>
