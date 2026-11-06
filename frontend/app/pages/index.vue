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
function useRail(
  key: string,
  params: Record<string, string | number | boolean>,
  pick: (list: ProductsResponse['data']) => ProductsResponse['data'] = list => list,
) {
  return useAsyncData<ProductsResponse>(
    key,
    () => soft($fetch<ProductsResponse>(`${apiBase}/products`, { params: { limit: 8, ...params } }), emptyPage),
    {
      default: () => emptyPage,
      transform: page => ({ data: pick(page.data).map(toCardProduct), pagination: page.pagination }),
    }
  )
}

/**
 * A varied row out of a longer list: at most two products of one category,
 * eight in all. Suppliers add products in batches, so the newest eight were
 * five flavours of one STARFIX polish.
 */
function varied(list: ProductsResponse['data'], size = 8, perCategory = 2) {
  const seen = new Map<string, number>()
  const row: ProductsResponse['data'] = []
  for (const product of list) {
    const key = product.category?.id ?? product.id
    if ((seen.get(key) ?? 0) >= perCategory) continue
    seen.set(key, (seen.get(key) ?? 0) + 1)
    row.push(product)
    if (row.length === size) break
  }
  return row
}

/** How many brand tiles the home page shows: two full rows of eight. */
const HOME_BRAND_COUNT = 16

// Eight independent requests: started together, the render waits for the
// slowest one instead of their sum.
const [
  { data: sales },
  { data: popular },
  { data: curatedPopular },
  { data: curatedTiles },
  { data: newest },
  { data: banners },
  { data: tree },
  { data: brands },
  { data: popularSearches },
] = await Promise.all([
  useRail('home-sales', { onSale: true, sortBy: 'createdAt', sortOrder: 'desc' }),
  useRail('home-popular', { inStock: true, sortBy: 'rating', sortOrder: 'desc' }),
  // «Выбирают покупатели» as an admin picked it in /admin/storefront; empty =
  // not curated, and the rated rail above stands in.
  useAsyncData(
    'home-popular-curated',
    () => soft($fetch<{ data: ProductsResponse['data'] }>(`${apiBase}/storefront/popular-products`), { data: [] }),
    { default: () => ({ data: [] }), transform: answer => ({ data: answer.data.map(toCardProduct) }) }
  ),
  useHomeCategoryTiles(),
  // Core departments only: since every supplier category is imported, the
  // newest products were enamel saucepans and a toilet bucket.
  useRail('home-newest', { sortBy: 'createdAt', sortOrder: 'desc', core: true, inStock: true, limit: 40 }, varied),
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
      // The biggest brands, not the first letters of the alphabet (3TON, 3M,
      // 5 Energy, A&P… was what the row showed).
      transform: list =>
        [...list]
          .sort((a, b) => (b._count?.products ?? 0) - (a._count?.products ?? 0) || a.name.localeCompare(b.name, 'ru'))
          .slice(0, HOME_BRAND_COUNT)
          .map(({ id, name, slug, logo, _count }) => ({ id, name, slug, logo, count: _count?.products ?? 0 })),
    }
  ),
  // What people search for — «Популярное:» under the search (empty until the
  // search journal has enough; the category picks stand in).
  useAsyncData<{ terms: string[] }>(
    'home-popular-searches',
    () => $fetch<{ terms: string[] }>(`${apiBase}/search/popular`).catch(() => ({ terms: [] })),
    { default: () => ({ terms: [] }) }
  ),
])

// The catalogue did not answer: show the technical-works page rather than a
// shop that looks sold out. Nitro never caches a 4xx/5xx response, so the
// outage page cannot outlive the outage.
if (unavailable.value) throw apiUnavailableError()

/**
 * The «Каталог» tiles follow the header strip an admin curates in
 * `/admin/storefront` (the same order as «Популярное:» under the search), and
 * the automatic grid — categories pinned in `/admin/categories`, then the
 * biggest roots — fills what is left, skipping what the strip already shows.
 * Twelve tiles (owner, 2026-11-06): every row is full at every width —
 * two rows of six on a computer, three of four on a tablet, four of three
 * on a phone.
 *
 * Tile artwork arrives with both answers: the API falls back to the photo of
 * the dearest product in a category's subtree when no admin set one.
 */
const HOME_CATEGORY_COUNT = 12
const topCategories = computed(() => {
  const curated = curatedTiles.value ?? []
  const shown = new Set(curated.map(category => category.id))
  const filler = featuredCategories(tree.value, HOME_CATEGORY_COUNT)
    .filter(category => !shown.has(category.id))
  return [...curated, ...filler].slice(0, HOME_CATEGORY_COUNT)
})

const popularProducts = computed(() =>
  curatedPopular.value.data.length
    ? curatedPopular.value.data
    : popular.value.data.filter((product) => product.ratingCount)
)

/**
 * «Популярное:» under the search: frequent real searches once there are
 * three, else the first tiles (the header strip's first picks).
 */
const heroLinks = computed(() => {
  const terms = popularSearches.value.terms
  if (terms.length >= 3) {
    return terms.map(term => ({ key: `q:${term}`, label: term, to: `/catalog?search=${encodeURIComponent(term)}` }))
  }
  return topCategories.value.slice(0, 4).map(category => ({
    key: category.id,
    label: category.name,
    to: `/catalog/${category.slug}`,
  }))
})

const recentlyViewed = useRecentlyViewed()

const courierCost = computed(() => Number(config.public.deliveryCourier))
const { terms } = useOrderTerms()
const postCost = computed(() => Number(config.public.deliveryPost))

function submitSearch() {
  const query = search.value.trim()
  navigateTo({ path: '/catalog', query: query ? { search: query } : undefined })
}

const description
  = 'Gost.by: инструмент, оборудование, крепёж и расходные материалы для организаций и частных покупателей. Счёт на оплату на сайте, безналичный расчёт, доставка по Беларуси, самовывоз в Витебске.'
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
        // The legal entity behind the shop: what a company buyer and a search
        // engine's business panel both look for.
        legalName: company.name,
        taxID: company.unp,
        url: homeUrl,
        logo: `${homeUrl}logo-mark.svg`,
        image: `${homeUrl}og-image.png`,
        telephone: company.phone,
        email: company.email,
        address: {
          '@type': 'PostalAddress',
          streetAddress: company.storeAddress.replace(/^г\.\s*Витебск,\s*/, ''),
          addressLocality: 'Витебск',
          addressCountry: 'BY',
        },
        areaServed: { '@type': 'Country', name: 'Беларусь' },
        paymentAccepted: 'Безналичный расчёт по счёту',
        currenciesAccepted: 'BYN',
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
        <h1>Инструмент и оборудование для организаций</h1>
        <p class="hero-sub">
          95 000+ позиций с ежедневным обновлением цен. Счёт на оплату — сразу
          на сайте, безналичный расчёт, договор поставки, доставка по Беларуси.
          Частных покупателей тоже ждём.
        </p>

        <form class="hero-search" role="search" @submit.prevent="submitSearch">
          <UiInput
            v-model="search"
            type="search"
            size="lg"
            placeholder="Название, артикул или штрихкод: перфоратор, GBH 2-26, KING TONY"
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
          <NuxtLink v-for="link in heroLinks" :key="link.key" :to="link.to">
            {{ link.label }}
          </NuxtLink>
        </div>
      </div>

      <!-- Contact card: the fastest path for a buyer who'd rather just ask -->
      <aside class="hero-contact">
        <span class="eyebrow">Отдел продаж</span>
        <a :href="company.phoneHref" class="hero-phone">{{ company.phone }}</a>
        <p>Подберём инструмент и аналоги, уточним наличие, выставим счёт организации</p>
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
          Организациям — бесплатно от {{ formatPrice(terms.freeDeliveryCompanyFrom, 'BYN') }}.
        </p>
        <NuxtLink to="/delivery">Условия доставки →</NuxtLink>
      </article>
      <article>
        <h3>Организациям</h3>
        <p>Счёт на оплату из корзины — без регистрации. Безналичный расчёт, договор поставки, прайс-лист в Excel.</p>
        <NuxtLink to="/organizaciyam">Как работаем с организациями →</NuxtLink>
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

    <!-- Curated in /admin/storefront, else what people actually wanted
         (orders, carts, search clicks, visits) in the core departments. -->
    <section v-if="popularProducts.length" class="block">
      <header class="block-head">
        <h2>Популярное у организаций</h2>
        <UiButton variant="link" to="/catalog?inStock=1">Всё в наличии →</UiButton>
      </header>
      <div class="product-grid">
        <ProductCatalogCard
          v-for="product in popularProducts"
          :key="product.id"
          :product="product"
        />
      </div>
    </section>

    <HomeForCompanies />

    <!-- Newest, core departments only -->
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
            <img v-if="item.image" :src="mediaSrc(item.image, 120, 2)" :alt="item.name" loading="lazy">
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
          <span v-else class="brand-name">{{ brand.name }}</span>
          <span v-if="brand.count" class="brand-count">{{ pluralize(brand.count, 'product') }}</span>
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
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--space-3);
}

/* Twelve tiles divide by 6, 4 and 3 — explicit columns keep every row full
   (auto-fill gave five on a laptop and a half-empty last row). */
@media (max-width: 1100px) {
  .category-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

/* Phones: three to a row — one 343px tile per row was a long scroll. */
@media (max-width: 560px) {
  .category-grid {
    gap: var(--space-2);
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
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
  display: flex;
  min-height: 72px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  color: var(--text-default);
  font-size: var(--text-sm);
  font-weight: 700;
  gap: 2px;
  text-align: center;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.brand-card:active {
  transform: scale(0.97);
}

.brand-name {
  overflow-wrap: anywhere;
}

.brand-count {
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.brand-card:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow-sm);
  color: var(--brand);
}

.brand-card img {
  max-width: 100%;
  max-height: 40px;
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
