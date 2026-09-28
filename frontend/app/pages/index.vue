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

type Brand = { id: string, name: string, slug: string }

const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase
const search = ref('')

// One request per rail; each degrades to an empty list rather than failing the
// whole page, since the home page is ISR-cached and must always render.
const { data: newest } = await useAsyncData<ProductsResponse>(
  'home-newest',
  () =>
    $fetch<ProductsResponse>(`${apiBase}/products`, {
      params: { limit: 8, sortBy: 'createdAt', sortOrder: 'desc' },
    }).catch(() => ({ data: [], pagination: { page: 1, limit: 8, total: 0, pages: 0 } })),
  { default: () => ({ data: [], pagination: { page: 1, limit: 8, total: 0, pages: 0 } }) }
)

const { data: sales } = await useAsyncData<ProductsResponse>(
  'home-sales',
  () =>
    $fetch<ProductsResponse>(`${apiBase}/products`, {
      params: { limit: 8, onSale: true, sortBy: 'createdAt', sortOrder: 'desc' },
    }).catch(() => ({ data: [], pagination: { page: 1, limit: 8, total: 0, pages: 0 } })),
  { default: () => ({ data: [], pagination: { page: 1, limit: 8, total: 0, pages: 0 } }) }
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

const topCategories = computed(() => (tree.value || []).slice(0, 8))
const topBrands = computed(() => (brands.value || []).slice(0, 12))
const totalProducts = computed(() => newest.value?.pagination.total || 0)

function submitSearch() {
  const query = search.value.trim()
  navigateTo({ path: '/catalog/', query: query ? { search: query } : undefined })
}

const description
  = 'Мультитул: каталог инструмента, оборудования, крепежа и расходных материалов от поставщиков Беларуси.'
const homeUrl = `${String(config.public.siteUrl).replace(/\/$/, '')}/`

useSeoMeta({
  title: 'Мультитул | Каталог инструмента и оборудования',
  description,
  ogTitle: 'Мультитул | Каталог инструмента и оборудования',
  ogDescription: description,
  ogType: 'website',
  ogUrl: homeUrl,
  twitterCard: 'summary',
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
    <!-- Hero -->
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">Каталог инструмента</span>
        <h1>Инструмент и оборудование от поставщиков — в одном каталоге</h1>
        <p>
          Ищите по названию, бренду или артикулу. Каталог пополняется автоматически,
          цены и наличие обновляются каждый день.
        </p>

        <form class="hero-search" role="search" @submit.prevent="submitSearch">
          <UiInput
            v-model="search"
            type="search"
            size="lg"
            placeholder="Например: домкрат, KING TONY, набор ключей"
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
          <NuxtLink v-for="category in topCategories.slice(0, 5)" :key="category.id" :to="`/catalog/${category.slug}`">
            {{ category.name }}
          </NuxtLink>
        </div>
      </div>

      <dl class="hero-stats">
        <div>
          <dt>товаров в каталоге</dt>
          <dd>{{ totalProducts }}</dd>
        </div>
        <div>
          <dt>категорий</dt>
          <dd>{{ tree.length }}</dd>
        </div>
        <div>
          <dt>брендов</dt>
          <dd>{{ brands.length }}</dd>
        </div>
      </dl>
    </section>

    <!-- Value props -->
    <section class="benefits">
      <article>
        <h3>Доставка по Беларуси</h3>
        <p>Курьером, почтой или самовывозом из Витебска.</p>
      </article>
      <article>
        <h3>Оплата как удобно</h3>
        <p>Наличными, картой или по счёту для юридических лиц.</p>
      </article>
      <article>
        <h3>Возврат 14 дней</h3>
        <p>По закону о защите прав потребителей.</p>
      </article>
      <article>
        <h3>Цены от поставщиков</h3>
        <p>Обновляются автоматически, без наценки за посредников.</p>
      </article>
    </section>

    <!-- Categories -->
    <section v-if="topCategories.length" class="block">
      <header class="block-head">
        <h2>Категории</h2>
        <UiButton variant="link" to="/catalog/">Весь каталог →</UiButton>
      </header>

      <div class="category-grid">
        <NuxtLink
          v-for="category in topCategories"
          :key="category.id"
          :to="`/catalog/${category.slug}`"
          class="category-card"
        >
          <span class="category-name">{{ category.name }}</span>
          <span class="category-count">{{ category.productCount }} товаров</span>
          <ul v-if="category.children.length" class="category-children">
            <li v-for="child in category.children.slice(0, 3)" :key="child.id">
              {{ child.name }}
            </li>
          </ul>
        </NuxtLink>
      </div>
    </section>

    <!-- Sales -->
    <section v-if="sales.data.length" class="block">
      <header class="block-head">
        <div>
          <h2>Со скидкой</h2>
          <p>Товары, на которые поставщик снизил цену</p>
        </div>
        <UiButton variant="link" to="/sales">Все акции →</UiButton>
      </header>

      <div class="product-grid">
        <ProductCatalogCard
          v-for="product in sales.data"
          :key="product.id"
          :product="product"
        />
      </div>
    </section>

    <!-- Newest -->
    <section v-if="newest.data.length" class="block">
      <header class="block-head">
        <div>
          <h2>Новинки каталога</h2>
          <p>Последние поступления от поставщиков</p>
        </div>
        <UiButton variant="link" to="/catalog/?sort=new">Смотреть все →</UiButton>
      </header>

      <div class="product-grid">
        <ProductCatalogCard
          v-for="product in newest.data"
          :key="product.id"
          :product="product"
        />
      </div>
    </section>

    <UiEmpty
      v-if="!newest.data.length && !sales.data.length"
      icon="box"
      title="Каталог пока пуст"
      description="Товары появятся, как только отработают парсеры поставщиков."
    />

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
          class="brand-chip"
        >
          {{ brand.name }}
        </NuxtLink>
      </div>
    </section>

    <!-- Contact -->
    <section class="contact">
      <div>
        <h2>Нужна помощь с подбором?</h2>
        <p>Позвоните или напишите — подскажем, что подойдёт под вашу задачу.</p>
      </div>
      <div class="contact-actions">
        <UiButton size="lg" :href="company.phoneHref">{{ company.phone }}</UiButton>
        <UiButton size="lg" variant="secondary" to="/contacts">Контакты</UiButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

/* ---- Hero ---- */
.hero {
  display: grid;
  align-items: center;
  padding: var(--space-10);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: linear-gradient(135deg, var(--brand-soft), var(--surface-card) 60%);
  gap: var(--space-8);
  grid-template-columns: minmax(0, 1fr) auto;
}

.hero-copy {
  display: flex;
  max-width: 62ch;
  flex-direction: column;
  gap: var(--space-3);
}

.hero h1 {
  font-size: var(--text-4xl);
}

.hero p {
  color: var(--text-muted);
  font-size: var(--text-md);
}

.hero-search {
  display: flex;
  margin-top: var(--space-3);
  gap: var(--space-2);
}

.hero-search :deep(.ui-input) {
  flex: 1;
}

.hero-links {
  display: flex;
  flex-wrap: wrap;
  margin-top: var(--space-2);
  gap: var(--space-2);
}

.hero-links a {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.hero-links a:hover {
  border-color: var(--brand);
  color: var(--brand);
}

.hero-stats {
  display: flex;
  flex-direction: column;
  margin: 0;
  gap: var(--space-4);
}

.hero-stats > div {
  display: flex;
  min-width: 160px;
  flex-direction: column-reverse;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.hero-stats dt {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.hero-stats dd {
  margin: 0;
  color: var(--text-strong);
  font-size: var(--text-2xl);
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

/* ---- Benefits ---- */
.benefits {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
}

.benefits article {
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.benefits h3 {
  margin-bottom: var(--space-1);
  font-size: var(--text-base);
}

.benefits p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* ---- Blocks ---- */
.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.block-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-3);
}

.block-head p {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--space-4);
}

/* ---- Categories ---- */
.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--space-4);
}

.category-card {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-1);
  transition:
    border-color var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.category-card:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.category-name {
  color: var(--text-strong);
  font-size: var(--text-md);
  font-weight: 700;
}

.category-count {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.category-children {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: var(--space-3) 0 0;
  gap: 2px;
  list-style: none;
}

.category-children li {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* ---- Brands ---- */
.brand-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.brand-chip {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-default);
  font-size: var(--text-sm);
  font-weight: 600;
}

.brand-chip:hover {
  border-color: var(--brand);
  color: var(--brand);
}

/* ---- Contact ---- */
.contact {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-8);
  border-radius: var(--radius-lg);
  background: var(--surface-inverse);
  color: var(--text-inverse);
  gap: var(--space-6);
}

.contact h2 {
  color: var(--text-inverse);
}

.contact p {
  margin-top: var(--space-2);
  opacity: 0.75;
}

.contact-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* ---- Responsive ---- */
@media (max-width: 900px) {
  .hero {
    padding: var(--space-6);
    grid-template-columns: 1fr;
  }

  .hero h1 {
    font-size: var(--text-2xl);
  }

  .hero-stats {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .hero-stats > div {
    flex: 1;
    min-width: 120px;
  }
}

@media (max-width: 640px) {
  .hero-search {
    flex-direction: column;
  }
}
</style>
