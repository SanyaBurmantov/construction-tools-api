<script setup lang="ts">
import type { Banner, Brand, ProductsResponse } from '~/types/api'
import { company } from '~/data/company'
import { toCardProduct } from '~/composables/useProductActions'

const config = useRuntimeConfig()
const { apiBase, absoluteUrl } = useSite()
const search = ref('')

const emptyPage = { data: [], pagination: { page: 1, limit: 8, total: 0, pages: 0 } }

/**
 * Each rail degrades to an empty list instead of failing the page — the home
 * page is cached and must always render. An **outage** is the exception: it is
 * remembered here and turned into the maintenance page below, because an empty
 * storefront tells the customer the wrong thing (see `isApiUnavailable`).
 * Only the product rails count: they are the shop.
 */
const unavailable = ref(false)

function soft<T>(request: Promise<T>, fallback: T): Promise<T> {
  return request.catch(error => {
    if (isApiUnavailable(error)) unavailable.value = true
    return fallback
  })
}

/**
 * One product rail. Whatever `useAsyncData` returns is serialised into the
 * cached HTML's `__NUXT_DATA__`, so each rail keeps only what a card renders:
 * the list endpoint also sends full brand/category rows, every image and
 * spec, and the catalogue-wide `facets` the home page never reads.
 */
function useRail(key: string, params: Record<string, string | number | boolean>) {
  return useAsyncData<ProductsResponse>(
    key,
    () => soft($fetch<ProductsResponse>(`${apiBase}/products`, { params: { limit: 8, ...params } }), emptyPage),
    {
      default: () => emptyPage,
      transform: page => ({ data: page.data.map(toCardProduct), pagination: page.pagination }),
    }
  )
}

/** How many brand tiles the home page shows. */
const HOME_BRAND_COUNT = 14

// Six independent requests: started together, the render waits for the
// slowest one instead of their sum.
const [
  { data: sales },
  { data: popular },
  { data: newest },
  { data: banners },
  { data: tree },
  { data: brands },
] = await Promise.all([
  useRail('home-sales', { onSale: true, sortBy: 'createdAt', sortOrder: 'desc' }),
  useRail('home-popular', { inStock: true, sortBy: 'rating', sortOrder: 'desc' }),
  useRail('home-newest', { sortBy: 'createdAt', sortOrder: 'desc' }),
  useAsyncData<{ data: Banner[] }>(
    'home-banners',
    // Banners and brands are decoration: they degrade quietly even when they
    // fail outright, and never on their own put the shop into maintenance.
    () => $fetch<{ data: Banner[] }>(`${apiBase}/banners`).catch(() => ({ data: [] })),
    { default: () => ({ data: [] }) }
  ),
  useCategoryTree(),
  /**
   * `GET /brands` answers with every brand and every column (~400 rows,
   * descriptions and SEO fields included — ~93 KB in the page payload). The
   * grid shows fourteen logos, so only those fourteen, and only what a tile
   * renders, reach the payload.
   */
  useAsyncData<Brand[]>(
    'home-brands',
    () => $fetch<Brand[]>(`${apiBase}/brands`).catch(() => []),
    {
      default: () => [],
      transform: list =>
        list.slice(0, HOME_BRAND_COUNT).map(({ id, name, slug, logo }) => ({ id, name, slug, logo })),
    }
  ),
])

// The catalogue did not answer: show the technical-works page rather than a
// shop that looks sold out. Nitro never caches a 4xx/5xx response, so the
// outage page cannot outlive the outage.
if (unavailable.value) throw apiUnavailableError()

/**
 * The grid an admin curates: categories pinned in `/admin/categories` lead,
 * then the biggest ones fill the row.
 *
 * Tile artwork arrives with the tree itself: `GET /categories/tree` falls
 * back to the photo of the dearest product in a category's subtree when no
 * admin set one. This page used to ask `/products?limit=1` once per tile for
 * that — a dozen extra requests per render, and it took whatever product came
 * first rather than the one worth showing.
 */
const HOME_CATEGORY_COUNT = 8
const topCategories = computed(() => featuredCategories(tree.value, HOME_CATEGORY_COUNT))

const popularProducts = computed(() =>
  popular.value.data.filter((product) => product.ratingCount)
)

const recentlyViewed = useRecentlyViewed()

const courierCost = computed(() => Number(config.public.deliveryCourier))
const postCost = computed(() => Number(config.public.deliveryPost))

function submitSearch() {
  const query = search.value.trim()
  navigateTo({ path: '/catalog', query: query ? { search: query } : undefined })
}

const description
  = 'Gost.by: инструмент, оборудование, крепёж и расходные материалы. Доставка по Беларуси, оплата картой или по счёту, самовывоз в Витебске.'
const homeUrl = absoluteUrl('/')

useSeoMeta({
  title: 'Gost.by — инструмент и оборудование в Беларуси',
  description,
  ogTitle: 'Gost.by — инструмент и оборудование в Беларуси',
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
        name: 'Gost.by',
        url: homeUrl,
        telephone: company.phone,
        email: company.email,
        address: { '@type': 'PostalAddress', streetAddress: company.storeAddress },
        potentialAction: {
          '@type': 'SearchAction',
          target: `${homeUrl}catalog?search={search_term_string}`,
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
              <UiIcon name="search" :size="20" :stroke-width="1.8" />
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
        <NuxtLink to="/garantiya">Гарантия и возврат →</NuxtLink>
      </article>
      <article>
        <h3>Наличие</h3>
        <p>Цены и остатки обновляются каждый день — то, что видите в каталоге, актуально.</p>
        <NuxtLink to="/catalog?inStock=1">Товары в наличии →</NuxtLink>
      </article>
    </section>

    <!-- Categories with pictures -->
    <section v-if="topCategories.length" class="block">
      <header class="block-head">
        <h2>Каталог</h2>
        <UiButton variant="link" to="/catalog">Все категории →</UiButton>
      </header>

      <div class="category-grid">
        <UiCategoryCard
          v-for="category in topCategories"
          :key="category.id"
          :name="category.name"
          :to="`/catalog/${category.slug}`"
          :count="category.productCount"
          :image="category.image"
          variant="tile"
        />
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
        <UiButton variant="link" to="/catalog?sort=rating-desc">Смотреть все →</UiButton>
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
        <UiButton variant="link" to="/catalog?sort=new">Смотреть все →</UiButton>
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
    <section v-if="brands.length" class="block">
      <header class="block-head">
        <h2>Бренды</h2>
        <UiButton variant="link" to="/brand">Все бренды →</UiButton>
      </header>
      <div class="brand-grid">
        <NuxtLink
          v-for="brand in brands"
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

/* ---- Categories ---- */
.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-3);
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
