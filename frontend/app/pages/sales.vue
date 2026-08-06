<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useProductActions'

type ProductsResponse = {
  data: CatalogProduct[]
  pagination: { page: number, limit: number, total: number, pages: number }
}

const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

const page = computed(() => Number(route.query.page) || 1)
const sort = computed(() => String(route.query.sort || 'discount'))

/**
 * `onSale=true` filters to products whose oldPrice really exceeds the current
 * price. The API has no "sort by discount size", so the default view sorts by
 * price and the biggest markdowns are surfaced by the badge on each card.
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

const { data, status } = await useAsyncData<ProductsResponse>(
  () => `sales-${page.value}-${sort.value}`,
  () =>
    $fetch<ProductsResponse>(`${apiBase}/products`, {
      params: { onSale: true, limit: 24, page: page.value, ...sortParams.value },
    }),
  {
    watch: [page, sort],
    default: () => ({ data: [], pagination: { page: 1, limit: 24, total: 0, pages: 0 } }),
  }
)

function setQuery(patch: Record<string, string | number | undefined>) {
  router.push({ query: { ...route.query, ...patch } })
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

const description
  = 'Товары со скидкой: инструмент, оборудование и расходные материалы по сниженным ценам.'
const canonical = computed(
  () => `${String(config.public.siteUrl).replace(/\/$/, '')}/sales`
)

useSeoMeta({
  title: 'Акции и скидки | Мультитул',
  description,
  ogTitle: 'Акции и скидки | Мультитул',
  ogDescription: description,
  ogType: 'website',
  ogUrl: () => canonical.value,
})

useHead({ link: [{ rel: 'canonical', href: canonical.value }] })
</script>

<template>
  <div class="sales-page">
    <UiBreadcrumbs :items="[{ label: 'Главная', to: '/' }, { label: 'Акции' }]" />

    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">Акции</span>
        <h1>Товары со скидкой</h1>
        <p>
          {{ description }}
          <template v-if="bestDiscount">
            Максимальная скидка на этой странице — {{ bestDiscount }}%.
          </template>
        </p>
      </div>
      <div class="hero-stat">
        <strong>{{ data.pagination.total }}</strong>
        <span>товаров по акции</span>
      </div>
    </section>

    <div v-if="data.pagination.total" class="toolbar">
      <UiSelect
        :model-value="sort"
        size="sm"
        :options="[
          { value: 'discount', label: 'Сначала новые' },
          { value: 'price-asc', label: 'Сначала дешевле' },
          { value: 'price-desc', label: 'Сначала дороже' },
          { value: 'rating', label: 'По рейтингу' }
        ]"
        @update:model-value="setQuery({ sort: String($event), page: 1 })"
      />
    </div>

    <div v-if="status === 'pending'" class="grid">
      <UiSkeleton v-for="i in 8" :key="i" height="340px" radius="var(--radius-md)" />
    </div>

    <UiEmpty
      v-else-if="!data.data.length"
      icon="search"
      title="Сейчас акций нет"
      description="Скидки появляются, когда поставщик снижает цену. Загляните в каталог — там больше
        товаров, или подпишитесь на обновления."
    >
      <UiButton to="/catalog/">Перейти в каталог</UiButton>
    </UiEmpty>

    <template v-else>
      <div class="grid">
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
        @change="setQuery({ page: $event })"
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

.hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-8);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--sale-soft), var(--surface-card));
  border: 1px solid var(--border-subtle);
  gap: var(--space-6);
}

.hero-copy {
  display: flex;
  max-width: 60ch;
  flex-direction: column;
  gap: var(--space-2);
}

.hero .eyebrow {
  color: var(--sale);
}

.hero p {
  color: var(--text-muted);
}

.hero-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-4) var(--space-6);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.hero-stat strong {
  color: var(--sale);
  font-size: var(--text-3xl);
  font-weight: 800;
  line-height: 1;
}

.hero-stat span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.toolbar {
  display: flex;
  justify-content: flex-end;
}

.toolbar :deep(.ui-select) {
  width: 240px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--space-4);
}

@media (max-width: 640px) {
  .hero {
    padding: var(--space-5);
  }
}
</style>
