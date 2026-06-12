<script setup lang="ts">
import ProductCatalogCard from '~/components/product/productCatalogCard.vue'

type FacetItem = {
  id: string
  name: string
  slug?: string
  code?: string
}

type Product = {
  id: string
  slug: string
  name: string
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
}

type CategoryTreeNode = {
  id: string
  name: string
  slug: string
  productCount: number
  children: CategoryTreeNode[]
}

const search = ref('')
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

const { data: products } = await useAsyncData<ProductResponse>(
  'home-products',
  () => $fetch(`${apiBase}/products`, { params: { limit: 8, sortBy: 'createdAt', sortOrder: 'desc' } }),
  { default: () => ({ data: [], pagination: { page: 1, limit: 8, total: 0, pages: 0 } }) }
)

const { data: tree } = await useAsyncData<CategoryTreeNode[]>(
  'catalog-tree',
  () => $fetch<CategoryTreeNode[]>(`${apiBase}/categories/tree`).catch(() => []),
  { default: () => [] }
)

const quickLinks = computed(() =>
  (tree.value || []).slice(0, 6).map(category => ({
    label: category.name,
    to: `/catalog/${category.slug}`
  }))
)

const topCategories = computed(() => (tree.value || []).slice(0, 8))

function submitSearch() {
  const query = search.value.trim()
  navigateTo({ path: '/catalog/', query: query ? { search: query } : undefined })
}

const homeDescription =
  'Мультитул: каталог инструмента, оборудования, крепежа и расходных материалов.'
const homeUrl = `${String(config.public.siteUrl).replace(/\/$/, '')}/`

useSeoMeta({
  title: 'Мультитул | Каталог инструмента и оборудования',
  description: homeDescription,
  ogTitle: 'Мультитул | Каталог инструмента и оборудования',
  ogDescription: homeDescription,
  ogType: 'website',
  ogUrl: homeUrl,
  twitterCard: 'summary'
})

useHead({
  link: [{ rel: 'canonical', href: homeUrl }]
})
</script>

<template>
  <div class="home-page">
    <section class="hero-card">
      <div class="hero-copy">
        <span class="eyebrow">Маркетплейс инструмента</span>
        <h1>Инструмент и оборудование от поставщиков в одном каталоге</h1>
        <p>
          Ищите по названию, бренду или артикулу — каталог пополняется новыми товарами каждый день.
        </p>

        <form class="hero-search" @submit.prevent="submitSearch">
          <input v-model="search" type="search" placeholder="Например: домкрат, KING TONY, набор ключей">
          <button type="submit">Найти</button>
        </form>

        <div class="quick-links">
          <NuxtLink v-for="link in quickLinks" :key="link.to" :to="link.to">
            {{ link.label }}
          </NuxtLink>
        </div>
      </div>

      <div class="hero-stats">
        <div>
          <strong>{{ products?.pagination.total || 0 }}</strong>
          <span>товаров в каталоге</span>
        </div>
        <div>
          <strong>24/7</strong>
          <span>обновление поставщиков</span>
        </div>
        <div>
          <strong>BYN</strong>
          <span>цены в белорусских рублях</span>
        </div>
      </div>
    </section>

    <section v-if="topCategories.length" class="home-categories">
      <div class="section-head">
        <div>
          <span class="eyebrow">Каталог</span>
          <h2>Популярные категории</h2>
        </div>
        <NuxtLink to="/catalog/" class="catalog-link">Весь каталог</NuxtLink>
      </div>

      <div class="categories-grid">
        <NuxtLink
          v-for="category in topCategories"
          :key="category.id"
          :to="`/catalog/${category.slug}`"
          class="category-card"
        >
          <strong>{{ category.name }}</strong>
          <span>{{ category.productCount }} товаров</span>
          <small v-if="category.children.length">
            {{ category.children.slice(0, 3).map(child => child.name).join(' · ') }}
          </small>
        </NuxtLink>
      </div>
    </section>

    <section v-if="products?.data.length" class="home-products">
      <div class="section-head">
        <div>
          <span class="eyebrow">Новые поступления</span>
          <h2>Последние товары</h2>
        </div>
        <NuxtLink to="/catalog/" class="catalog-link">Смотреть все</NuxtLink>
      </div>

      <div class="products-grid">
        <ProductCatalogCard
          v-for="product in products.data"
          :key="product.id"
          :product="product"
        />
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.home-page {
  display: grid;
  gap: 28px;
}

.hero-card {
  display: grid;
  gap: 24px;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 28px;
  background:
    linear-gradient(120deg, rgba(29, 78, 216, 0.08), rgba(255, 207, 38, 0.12)),
    white;
  box-shadow: var(--shadow-card);
  padding: clamp(24px, 5vw, 52px);

  @include media-breakpoint-up(lg) {
    grid-template-columns: minmax(0, 1fr) 340px;
    align-items: center;
  }
}

.hero-copy {
  display: grid;
  gap: 18px;
  max-width: 760px;

  h1 {
    max-width: 760px;
    font-size: clamp(34px, 5vw, 58px);
    line-height: 1.04;
  }

  p {
    max-width: 660px;
    color: var(--color-muted);
    font-size: 18px;
  }
}

.hero-search {
  display: grid;
  overflow: hidden;
  max-width: 760px;
  border: 2px solid var(--color-primary);
  border-radius: 16px;
  background: white;

  @include media-breakpoint-up(md) {
    grid-template-columns: minmax(0, 1fr) 132px;
  }

  input {
    min-height: 54px;
    border: 0;
    outline: 0;
    padding: 0 16px;
  }

  button {
    min-height: 54px;
    background: var(--color-primary);
    color: white;
    cursor: pointer;
    font-weight: 900;
  }
}

.quick-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  a {
    border: 1px solid #c7d7fe;
    border-radius: 999px;
    background: #eef4ff;
    color: var(--color-primary);
    font-weight: 800;
    padding: 8px 12px;
    text-decoration: none;
  }
}

.hero-stats {
  display: grid;
  gap: 12px;

  div {
    border: 1px solid var(--color-line);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.84);
    padding: 18px;
  }

  strong {
    display: block;
    color: #101828;
    font-size: 30px;
    font-weight: 900;
  }

  span {
    color: var(--color-muted);
    font-weight: 700;
  }
}

.home-products,
.home-categories {
  display: grid;
  gap: 18px;
}

.categories-grid {
  display: grid;
  gap: 12px;

  @include media-breakpoint-up(sm) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @include media-breakpoint-up(lg) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.category-card {
  display: grid;
  gap: 6px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: white;
  padding: 18px;
  text-decoration: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;

  strong {
    color: #101828;
    font-size: 16px;
    font-weight: 800;
  }

  span {
    color: var(--color-primary);
    font-size: 13px;
    font-weight: 700;
  }

  small {
    overflow: hidden;
    color: var(--color-muted);
    font-size: 12px;
    line-height: 1.5;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover {
    border-color: #c7d7fe;
    box-shadow: var(--shadow-card);
  }
}

.section-head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
  justify-content: space-between;

  h2 {
    margin-top: 4px;
    font-size: clamp(26px, 4vw, 38px);
  }
}

.catalog-link {
  border-radius: 12px;
  background: var(--color-primary);
  color: white;
  font-weight: 900;
  padding: 11px 16px;
  text-decoration: none;
}

.products-grid {
  display: grid;
  gap: 16px;

  @include media-breakpoint-up(sm) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @include media-breakpoint-up(lg) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
