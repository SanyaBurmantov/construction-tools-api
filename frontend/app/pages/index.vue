<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useProductActions'
import { company } from '~/data/company'

type ProductsResponse = {
  data: CatalogProduct[]
  pagination: { page: number, limit: number, total: number, pages: number }
}

type CategoryTreeNode = {
  id: string
  name: string
  slug: string
  productCount: number
  children: CategoryTreeNode[]
}

type Brand = { id: string, name: string, slug: string, logo?: string | null }

type Banner = {
  id: string
  title: string
  subtitle: string | null
  imageUrl: string
  mobileUrl: string | null
  linkUrl: string | null
  buttonText: string | null
  bgColor: string | null
}

const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase
const { formatPrice } = useFormatPrice()
const search = ref('')

const emptyPage = { data: [], pagination: { page: 1, limit: 8, total: 0, pages: 0 } }

// Each rail degrades to an empty list instead of failing the page — the home
// page is ISR-cached and must always render.
const { data: sales } = await useAsyncData<ProductsResponse>(
  'home-sales',
  () =>
    $fetch<ProductsResponse>(`${apiBase}/products`, {
      params: { limit: 8, onSale: true, sortBy: 'createdAt', sortOrder: 'desc' },
    }).catch(() => emptyPage),
  { default: () => emptyPage }
)

const { data: popular } = await useAsyncData<ProductsResponse>(
  'home-popular',
  () =>
    $fetch<ProductsResponse>(`${apiBase}/products`, {
      params: { limit: 8, inStock: true, sortBy: 'rating', sortOrder: 'desc' },
    }).catch(() => emptyPage),
  { default: () => emptyPage }
)

const { data: newest } = await useAsyncData<ProductsResponse>(
  'home-newest',
  () =>
    $fetch<ProductsResponse>(`${apiBase}/products`, {
      params: { limit: 8, sortBy: 'createdAt', sortOrder: 'desc' },
    }).catch(() => emptyPage),
  { default: () => emptyPage }
)

const { data: banners } = await useAsyncData<{ data: Banner[] }>(
  'home-banners',
  () => $fetch<{ data: Banner[] }>(`${apiBase}/banners`).catch(() => ({ data: [] })),
  { default: () => ({ data: [] }) }
)

const { data: tree } = await useAsyncData<CategoryTreeNode[]>(
  'catalog-tree',
  () => $fetch<CategoryTreeNode[]>(`${apiBase}/categories/tree`).catch(() => []),
  { default: () => [] }
)

const { data: brands } = await useAsyncData<Brand[]>(
  'home-brands',
  () => $fetch<Brand[]>(`${apiBase}/brands`).catch(() => []),
  { default: () => [] }
)

/**
 * Category tiles need a picture, and there is no artwork for categories — so
 * each tile borrows the first product image found in its subtree. Costs one
 * extra request and turns a wall of text boxes into a browsable grid.
 */
const { data: categoryImages } = await useAsyncData<Record<string, string>>(
  'home-category-images',
  async () => {
    const roots = (tree.value || []).slice(0, 8)
    const pairs = await Promise.all(
      roots.map(async (category) => {
        const response = await $fetch<ProductsResponse>(`${apiBase}/products`, {
          params: { categorySlug: category.slug, limit: 1 },
        }).catch(() => emptyPage)
        return [category.slug, response.data[0]?.images?.[0]?.url ?? ''] as const
      })
    )
    return Object.fromEntries(pairs.filter(([, url]) => url))
  },
  { watch: [tree], default: () => ({}) }
)

const topCategories = computed(() => (tree.value || []).slice(0, 8))
const topBrands = computed(() => (brands.value || []).slice(0, 14))
const popularProducts = computed(() =>
  popular.value.data.filter((product) => product.ratingCount)
)

const recentlyViewed = useRecentlyViewed()

const courierCost = computed(() => Number(config.public.deliveryCourier))
const postCost = computed(() => Number(config.public.deliveryPost))

function submitSearch() {
  const query = search.value.trim()
  navigateTo({ path: '/catalog/', query: query ? { search: query } : undefined })
}

const description
  = 'Мультитул: инструмент, оборудование, крепёж и расходные материалы. Доставка по Беларуси, оплата картой или по счёту, самовывоз в Витебске.'
const homeUrl = `${String(config.public.siteUrl).replace(/\/$/, '')}/`

useSeoMeta({
  title: 'Мультитул — инструмент и оборудование в Беларуси',
  description,
  ogTitle: 'Мультитул — инструмент и оборудование в Беларуси',
  ogDescription: description,
  ogType: 'website',
  ogUrl: homeUrl,
})

useHead({
  link: [{ rel: 'canonical', href: homeUrl }],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Store',
        name: 'Мультитул',
        url: homeUrl,
        telephone: company.phone,
        email: company.email,
        address: { '@type': 'PostalAddress', streetAddress: company.storeAddress },
        potentialAction: {
          '@type': 'SearchAction',
          target: `${homeUrl}catalog/?search={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      }),
    },
  ],
})
</script>

<template>
  <div class="home">
    <HomeHeroBanners v-if="banners.data.length" :banners="banners.data" />

    <!-- Hero: search and categories, not a slogan -->
    <section class="hero">
      <div class="hero-main">
        <h1>Инструмент и оборудование</h1>
        <p class="hero-sub">
          Подберём под задачу, отгрузим со склада или привезём под заказ.
          Работаем с физлицами и организациями.
        </p>

        <form class="hero-search" role="search" @submit.prevent="submitSearch">
          <UiInput
            v-model="search"
            type="search"
            size="lg"
            placeholder="Что ищете? Например: перфоратор, набор ключей, KING TONY"
            aria-label="Поиск по каталогу"
          >
            <template #leading>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm7.5 14.5L16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </template>
          </UiInput>
          <UiButton type="submit" size="lg">Найти</UiButton>
        </form>

        <div class="hero-links">
          <span>Популярное:</span>
          <NuxtLink
            v-for="category in topCategories.slice(0, 4)"
            :key="category.id"
            :to="`/catalog/${category.slug}`"
          >
            {{ category.name }}
          </NuxtLink>
        </div>
      </div>

      <!-- Contact card: the fastest path for a buyer who'd rather just ask -->
      <aside class="hero-contact">
        <span class="eyebrow">Отдел продаж</span>
        <a :href="company.phoneHref" class="hero-phone">{{ company.phone }}</a>
        <p>Поможем подобрать инструмент и уточним наличие</p>
        <UiButton variant="secondary" block :href="company.emailHref">
          Написать на почту
        </UiButton>
        <dl class="hero-facts">
          <div>
            <dt>Самовывоз</dt>
            <dd>{{ company.storeAddress }}</dd>
          </div>
        </dl>
      </aside>
    </section>

    <!-- Trust strip: concrete terms, not adjectives -->
    <section class="terms">
      <article>
        <h3>Доставка</h3>
        <p>
          Курьер — {{ formatPrice(courierCost, 'BYN') }}, почта —
          {{ formatPrice(postCost, 'BYN') }}, самовывоз бесплатно.
        </p>
        <NuxtLink to="/delivery">Условия доставки →</NuxtLink>
      </article>
      <article>
        <h3>Оплата</h3>
        <p>Наличными или картой при получении. Организациям — счёт и закрывающие документы.</p>
        <NuxtLink to="/delivery">Способы оплаты →</NuxtLink>
      </article>
      <article>
        <h3>Возврат</h3>
        <p>14 дней на возврат товара надлежащего качества по закону о защите прав потребителей.</p>
        <NuxtLink to="/oferta">Публичная оферта →</NuxtLink>
      </article>
      <article>
        <h3>Наличие</h3>
        <p>Цены и остатки обновляются каждый день — то, что видите в каталоге, актуально.</p>
        <NuxtLink to="/catalog/?inStock=1">Товары в наличии →</NuxtLink>
      </article>
    </section>

    <!-- Categories with pictures -->
    <section v-if="topCategories.length" class="block">
      <header class="block-head">
        <h2>Каталог</h2>
        <UiButton variant="link" to="/catalog/">Все категории →</UiButton>
      </header>

      <div class="category-grid">
        <NuxtLink
          v-for="category in topCategories"
          :key="category.id"
          :to="`/catalog/${category.slug}`"
          class="category-card"
        >
          <div class="category-image">
            <img
              v-if="categoryImages[category.slug]"
              :src="categoryImages[category.slug]"
              :alt="category.name"
              loading="lazy"
            >
            <span v-else class="category-image-empty" aria-hidden="true" />
          </div>
          <div class="category-body">
            <span class="category-name">{{ category.name }}</span>
            <span class="category-count">{{ category.productCount }} товаров</span>
          </div>
        </NuxtLink>
      </div>
    </section>

    <!-- Sales -->
    <section v-if="sales.data.length" class="block">
      <header class="block-head">
        <h2>Со скидкой</h2>
        <UiButton variant="link" to="/sales">Все акции →</UiButton>
      </header>
      <div class="product-grid">
        <ProductCatalogCard v-for="product in sales.data" :key="product.id" :product="product" />
      </div>
    </section>

    <!-- Rated by customers -->
    <section v-if="popularProducts.length" class="block">
      <header class="block-head">
        <h2>Выбирают покупатели</h2>
        <UiButton variant="link" to="/catalog/?sort=rating-desc">Смотреть все →</UiButton>
      </header>
      <div class="product-grid">
        <ProductCatalogCard
          v-for="product in popularProducts"
          :key="product.id"
          :product="product"
        />
      </div>
    </section>

    <!-- Newest -->
    <section v-if="newest.data.length" class="block">
      <header class="block-head">
        <h2>Новинки</h2>
        <UiButton variant="link" to="/catalog/?sort=new">Смотреть все →</UiButton>
      </header>
      <div class="product-grid">
        <ProductCatalogCard v-for="product in newest.data" :key="product.id" :product="product" />
      </div>
    </section>

    <UiEmpty
      v-if="!newest.data.length && !sales.data.length"
      icon="box"
      title="Каталог пока пуст"
      description="Товары появятся, как только отработают парсеры поставщиков."
    />

    <!-- Recently viewed -->
    <ClientOnly>
      <section v-if="recentlyViewed.items.value.length" class="block">
        <header class="block-head">
          <h2>Вы смотрели</h2>
          <UiButton variant="link" @click="recentlyViewed.clear()">Очистить</UiButton>
        </header>
        <div class="viewed-grid">
          <NuxtLink
            v-for="item in recentlyViewed.items.value"
            :key="item.slug"
            :to="`/product/${item.slug}`"
            class="viewed-card"
          >
            <img v-if="item.image" :src="item.image" :alt="item.name" loading="lazy">
            <span v-else class="viewed-empty" aria-hidden="true" />
            <span class="viewed-name">{{ item.name }}</span>
            <strong>{{ formatPrice(item.price, item.currency) }}</strong>
          </NuxtLink>
        </div>
      </section>
    </ClientOnly>

    <!-- Brands -->
    <section v-if="topBrands.length" class="block">
      <header class="block-head">
        <h2>Бренды</h2>
        <UiButton variant="link" to="/brand/">Все бренды →</UiButton>
      </header>
      <div class="brand-grid">
        <NuxtLink
          v-for="brand in topBrands"
          :key="brand.id"
          :to="`/brand/${brand.slug}`"
          class="brand-card"
        >
          <img v-if="brand.logo" :src="brand.logo" :alt="brand.name" loading="lazy">
          <span v-else>{{ brand.name }}</span>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

/* ---- Hero ---- */
.hero {
  display: grid;
  align-items: stretch;
  gap: var(--space-5);
  grid-template-columns: minmax(0, 1fr) 320px;
}

.hero-main {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: var(--space-8);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--brand-soft), var(--surface-card) 65%);
  gap: var(--space-3);
}

.hero-main h1 {
  font-size: var(--text-3xl);
}

.hero-sub {
  max-width: 56ch;
  color: var(--text-muted);
}

.hero-search {
  display: flex;
  margin-top: var(--space-2);
  gap: var(--space-2);
}

.hero-search :deep(.ui-input) {
  flex: 1;
}

.hero-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.hero-links a {
  color: var(--text-link);
}

.hero-links a:hover {
  text-decoration: underline;
}

.hero-contact {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  gap: var(--space-2);
}

.hero-phone {
  color: var(--text-strong);
  font-size: var(--text-xl);
  font-weight: 800;
  letter-spacing: var(--tracking-tight);
}

.hero-phone:hover {
  color: var(--brand);
}

.hero-contact p {
  margin-bottom: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.hero-facts {
  margin: auto 0 0;
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

.hero-facts dt {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.hero-facts dd {
  margin: 2px 0 0;
  color: var(--text-default);
  font-size: var(--text-sm);
}

/* ---- Terms ---- */
.terms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: var(--space-3);
}

.terms article {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-1);
}

.terms h3 {
  font-size: var(--text-base);
}

.terms p {
  flex: 1;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.terms a {
  margin-top: var(--space-2);
  color: var(--text-link);
  font-size: var(--text-sm);
  font-weight: 600;
}

.terms a:hover {
  text-decoration: underline;
}

/* ---- Blocks ---- */
.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.block-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(228px, 1fr));
  gap: var(--space-4);
}

/* ---- Categories ---- */
.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-3);
}

.category-card {
  display: flex;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  transition:
    border-color var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

.category-card:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow-md);
}

.category-image {
  aspect-ratio: 4 / 3;
  padding: var(--space-4);
  background: var(--surface-card);
}

.category-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: var(--image-blend);
}

.category-image-empty {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.category-body {
  display: flex;
  flex-direction: column;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

.category-name {
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.category-count {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

/* ---- Recently viewed ---- */
.viewed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-3);
}

.viewed-card {
  display: flex;
  flex-direction: column;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-1);
}

.viewed-card:hover {
  border-color: var(--brand);
}

.viewed-card img,
.viewed-empty {
  width: 100%;
  height: 90px;
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  object-fit: contain;
}

.viewed-name {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-default);
  font-size: var(--text-xs);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.viewed-card strong {
  color: var(--text-strong);
  font-size: var(--text-sm);
}

/* ---- Brands ---- */
.brand-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-3);
}

.brand-card {
  display: grid;
  height: 68px;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  color: var(--text-default);
  font-size: var(--text-sm);
  font-weight: 700;
  place-items: center;
  text-align: center;
}

.brand-card:hover {
  border-color: var(--brand);
  color: var(--brand);
}

.brand-card img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* ---- Responsive ---- */
@media (max-width: 960px) {
  .hero {
    grid-template-columns: 1fr;
  }

  .hero-main {
    padding: var(--space-5);
  }

  .hero-main h1 {
    font-size: var(--text-2xl);
  }
}

@media (max-width: 560px) {
  .hero-search {
    flex-direction: column;
  }
}
</style>
