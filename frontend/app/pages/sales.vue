<script setup lang="ts">
import type { ProductsResponse } from '~/types/api'
import { toCardProduct } from '~/composables/useProductActions'

const route = useRoute()
const router = useRouter()
const { apiBase } = useSite()

const SORT_OPTIONS = [
  { value: 'new', label: 'Сначала новые' },
  { value: 'price-asc', label: 'Сначала дешевле' },
  { value: 'price-desc', label: 'Сначала дороже' },
  { value: 'rating', label: 'По рейтингу' },
]

const page = computed(() => Math.max(1, Number(route.query.page) || 1))
const sort = computed(() => String(route.query.sort || 'new'))

/**
 * `onSale=true` filters to products whose oldPrice really exceeds the current
 * price. The API has no "sort by discount size", so the default view puts the
 * newest markdowns first and the biggest ones are surfaced by the badge on
 * each card.
 */
const sortParams = computed<Record<string, string>>(() => {
  switch (sort.value) {
    case 'price-asc':
      return { sortBy: 'price', sortOrder: 'asc' }
    case 'price-desc':
      return { sortBy: 'price', sortOrder: 'desc' }
    case 'rating':
      return { sortBy: 'rating', sortOrder: 'desc' }
    default:
      return { sortBy: 'createdAt', sortOrder: 'desc' }
  }
})

// The key carries page and sort, so it alone re-runs the fetch. Rows are cut
// to what a card renders — see `toCardProduct`.
const { data, status, error } = await useAsyncData<ProductsResponse>(
  () => `sales-${page.value}-${sort.value}`,
  () =>
    $fetch<ProductsResponse>(`${apiBase}/products`, {
      params: { onSale: true, limit: 24, page: page.value, ...sortParams.value },
    }),
  {
    default: () => ({ data: [], pagination: { page: 1, limit: 24, total: 0, pages: 0 } }),
    transform: response => ({ data: response.data.map(toCardProduct), pagination: response.pagination }),
  }
)

// Without this the page falls back to its empty default and reads as «скидок
// нет» while the API is simply down. Server-side only: on the client the page
// is already rendered and a blip must not replace it.
if (import.meta.server && isApiUnavailable(error.value)) throw apiUnavailableError()
// Past the last page: a 404, not an empty page with 200 (see CatalogView).
if (import.meta.server && !error.value && page.value > Math.max(1, data.value.pagination.pages)) {
  throw createError({ statusCode: 404, statusMessage: 'Страница не найдена', fatal: true })
}

function setQuery(patch: Record<string, string | number | undefined>) {
  router.push({ query: { ...route.query, ...patch } })
}

/** The pager renders these as real links — crawlers only follow an href. */
function pageHref(next: number) {
  return router.resolve({ query: { ...route.query, page: next > 1 ? String(next) : undefined } }).href
}

/** Deepest markdown on the page — used for the hero headline. */
const bestDiscount = computed(() => {
  let best = 0
  for (const product of data.value.data) {
    if (product.oldPrice && product.priceValue && product.oldPrice > product.priceValue) {
      best = Math.max(best, Math.round((1 - product.priceValue / product.oldPrice) * 100))
    }
  }
  return best
})

const heroStats = computed(() => {
  const total = data.value.pagination.total
  return [{ value: total, label: `${plural(total, ...PLURALS.product)} по акции` }]
})

const description
  = 'Товары со скидкой: инструмент, оборудование и расходные материалы по сниженным ценам.'

// Page-aware like the catalogue: every `?page=N` had the same title and a
// canonical to page 1. A page under a non-default sort points at the plain
// listing.
const { absoluteUrl } = useSite()
const pageSuffix = computed(() => (page.value > 1 ? ` — страница ${page.value}` : ''))
const seoTitle = computed(() => `Акции и скидки${pageSuffix.value} | Gost.by`)
const seoDescription = computed(() => description + (page.value > 1 ? ` Страница ${page.value}.` : ''))
const canonicalUrl = computed(() =>
  absoluteUrl(page.value > 1 && sort.value === 'new' ? `/sales?page=${page.value}` : '/sales'))
useSeoMeta({
  title: seoTitle,
  description: seoDescription,
  ogTitle: seoTitle,
  ogDescription: seoDescription,
  ogUrl: canonicalUrl,
  ogType: 'website',
})
useHead(() => ({ link: [{ rel: 'canonical', href: canonicalUrl.value }] }))
</script>

<template>
  <div class="sales-page">
    <UiBreadcrumbs :items="[{ label: 'Главная', to: '/' }, { label: 'Акции' }]" />

    <StorefrontPageHero
      eyebrow="Акции"
      title="Товары со скидкой"
      tone="sale"
      :stats="heroStats"
    >
      <p>
        {{ description }}
        <template v-if="bestDiscount">
          Максимальная скидка на этой странице — {{ bestDiscount }}%.
        </template>
      </p>
    </StorefrontPageHero>

    <div v-if="data.pagination.total" class="toolbar">
      <UiSelect
        :model-value="sort"
        size="sm"
        :options="SORT_OPTIONS"
        @update:model-value="setQuery({ sort: String($event), page: undefined })"
      />
    </div>

    <div v-if="status === 'pending'" class="product-grid">
      <UiSkeleton v-for="i in 8" :key="i" height="340px" radius="var(--radius-md)" />
    </div>

    <UiEmpty
      v-else-if="!data.data.length"
      icon="search"
      title="Сейчас акций нет"
      description="Скидки появляются, когда поставщик снижает цену. Загляните в каталог — там больше
        товаров, или подпишитесь на обновления."
    >
      <UiButton to="/catalog">Перейти в каталог</UiButton>
    </UiEmpty>

    <template v-else>
      <div class="product-grid">
        <ProductCatalogCard
          v-for="product in data.data"
          :key="product.id"
          :product="product"
        />
      </div>

      <UiPagination
        :page="data.pagination.page"
        :pages="data.pagination.pages"
        :total="data.pagination.total"
        :href-for="pageHref"
        @change="setQuery({ page: $event > 1 ? $event : undefined })"
      />
    </template>
  </div>
</template>

<style scoped>
.sales-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.toolbar {
  display: flex;
  justify-content: flex-end;
}

.toolbar :deep(.ui-select) {
  width: 240px;
}
</style>
