<script setup lang="ts">
type Brand = {
  id: string
  name: string
  slug?: string | null
}

type BrandCategory = {
  id: string
  name: string
  slug?: string | null
  count: number
}

type BrandCategoriesResponse = {
  brand: Brand
  categories: BrandCategory[]
}

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase
const slug = computed(() => String(route.params.slug || ''))

const { data, status, error } = await useAsyncData<BrandCategoriesResponse>(
  () => `brand-categories:${slug.value}`,
  () => $fetch<BrandCategoriesResponse>(`${apiBase}/brands/${slug.value}/categories`),
  { watch: [slug] }
)

if (error.value) {
  throw createError({ statusCode: 404, statusMessage: 'Бренд не найден', fatal: true })
}

const brand = computed(() => data.value?.brand || null)
const categories = computed(() => data.value?.categories || [])
const totalProducts = computed(() =>
  categories.value.reduce((sum, category) => sum + category.count, 0)
)

/**
 * Category pages take the brand filter through the shared `brands` query param,
 * so the landing page hands off into the normal catalog view already filtered.
 */
function categoryLink(category: BrandCategory) {
  if (!brand.value?.id) return '/catalog/'
  if (category.slug) return `/catalog/${category.slug}?brands=${brand.value.id}`
  return `/catalog/?brands=${brand.value.id}&categoryId=${category.id}`
}

const allProductsLink = computed(() =>
  brand.value?.id ? `/catalog/?brands=${brand.value.id}` : '/catalog/'
)

const description = computed(() =>
  brand.value
    ? `Товары бренда ${brand.value.name} в каталоге Мультитул: ${totalProducts.value} позиций в ${categories.value.length} категориях.`
    : 'Категории бренда в каталоге Мультитул.'
)
const canonical = computed(
  () => `${String(config.public.siteUrl).replace(/\/$/, '')}/brand/${slug.value}`
)

useSeoMeta({
  title: () => (brand.value ? `${brand.value.name} | Мультитул` : 'Бренд | Мультитул'),
  description: () => description.value,
  ogTitle: () => (brand.value ? `${brand.value.name} | Мультитул` : 'Бренд | Мультитул'),
  ogDescription: () => description.value,
  ogType: 'website',
  ogUrl: () => canonical.value,
})

useHead({ link: [{ rel: 'canonical', href: canonical.value }] })
</script>

<template>
  <div class="brand-page">
    <UiBreadcrumbs
      :items="[
        { label: 'Главная', to: '/' },
        { label: 'Бренды', to: '/brand/' },
        { label: brand?.name || 'Бренд' }
      ]"
    />

    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">Бренд</span>
        <h1>{{ brand?.name }}</h1>
        <p>Выберите категорию, чтобы открыть каталог с товарами этого бренда.</p>
        <div class="hero-actions">
          <UiButton :to="allProductsLink" size="sm">Все товары бренда</UiButton>
          <UiButton to="/brand/" variant="secondary" size="sm">Все бренды</UiButton>
        </div>
      </div>

      <div class="hero-stats">
        <div class="hero-stat">
          <strong>{{ totalProducts }}</strong>
          <span>товаров</span>
        </div>
        <div class="hero-stat">
          <strong>{{ categories.length }}</strong>
          <span>категорий</span>
        </div>
      </div>
    </section>

    <div v-if="status === 'pending'" class="grid">
      <UiSkeleton v-for="i in 6" :key="i" height="96px" radius="var(--radius-md)" />
    </div>

    <UiEmpty
      v-else-if="!categories.length"
      icon="box"
      title="У этого бренда пока нет товаров"
      description="Товары появятся здесь, как только они попадут в каталог."
    >
      <UiButton to="/catalog/">Перейти в каталог</UiButton>
    </UiEmpty>

    <section v-else class="grid">
      <NuxtLink
        v-for="category in categories"
        :key="category.id"
        :to="categoryLink(category)"
        class="category-card"
      >
        <span class="category-text">
          <span class="category-name">{{ category.name }}</span>
          <span class="category-count">{{ category.count }} товаров</span>
        </span>
        <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </NuxtLink>
    </section>
  </div>
</template>

<style scoped>
.brand-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-8);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--brand-soft), var(--surface-card));
}

.hero-copy {
  display: flex;
  max-width: 60ch;
  flex-direction: column;
  gap: var(--space-2);
}

.hero .eyebrow {
  color: var(--brand);
}

.hero p {
  color: var(--text-muted);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.hero-stats {
  display: flex;
  gap: var(--space-3);
}

.hero-stat {
  display: flex;
  min-width: 110px;
  flex-direction: column;
  align-items: center;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.hero-stat strong {
  color: var(--brand);
  font-size: var(--text-3xl);
  font-weight: 800;
  line-height: 1;
}

.hero-stat span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-3);
}

.category-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  text-decoration: none;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.category-card:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow-sm);
}

.category-card:hover .chevron {
  color: var(--brand);
}

.category-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.category-name {
  color: var(--text-strong);
  font-weight: 700;
}

.category-count {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.chevron {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--text-subtle);
  transition: color var(--duration-fast) var(--ease-out);
}

@media (max-width: 640px) {
  .hero {
    padding: var(--space-5);
  }

  .hero-stats {
    width: 100%;
  }

  .hero-stat {
    flex: 1;
  }
}
</style>
