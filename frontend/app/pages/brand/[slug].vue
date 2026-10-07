<script setup lang="ts">
type Brand = {
  id: string
  name: string
  slug?: string
}

type BrandCategory = {
  id: string
  name: string
  slug?: string
  count: number
}

type BrandCategoriesResponse = {
  brand: Brand
  categories: BrandCategory[]
}

type ProductResponse = {
  data: Array<{
    categoryId?: string | null
    category?: {
      id: string
      name: string
      slug?: string
    } | null
  }>
}

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase
const slug = computed(() => String(route.params.slug || ''))

const emptyResponse: BrandCategoriesResponse = {
  brand: { id: '', name: '' },
  categories: []
}

const { data: brandData, pending, error } = await useAsyncData<BrandCategoriesResponse | null>(
  () => `brand-categories-${slug.value}`,
  async () => {
    const directResponse = await $fetch<BrandCategoriesResponse | null>(`${apiBase}/brands/${slug.value}/categories`).catch(() => null)

    if (directResponse?.brand) {
      return directResponse
    }

    const brands = await $fetch<Brand[]>(`${apiBase}/brands`).catch(() => [])
    const currentBrand = brands.find(item => item.id === slug.value || item.slug === slug.value)

    if (!currentBrand) {
      return null
    }

    const products = await $fetch<ProductResponse>(`${apiBase}/products`, {
      params: {
        brandId: currentBrand.id,
        limit: 1000,
        page: 1
      }
    }).catch(() => ({ data: [] }))

    const categoriesMap = (products.data || []).reduce<Record<string, BrandCategory>>((acc, product) => {
      if (!product.categoryId || !product.category?.name) {
        return acc
      }

      if (!acc[product.categoryId]) {
        acc[product.categoryId] = {
          id: product.category.id,
          name: product.category.name,
          slug: product.category.slug,
          count: 0
        }
      }

      acc[product.categoryId].count += 1
      return acc
    }, {})

    return {
      brand: currentBrand,
      categories: Object.values(categoriesMap)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
    }
  },
  { default: () => null, watch: [slug] }
)

const brand = computed(() => brandData.value?.brand || null)
const categories = computed(() => brandData.value?.categories || emptyResponse.categories)
const totalProducts = computed(() => categories.value.reduce((sum, category) => sum + category.count, 0))

function categoryLink(category: BrandCategory) {
  if (!brand.value?.id) return '/catalog/'
  if (category.slug) return `/catalog/${category.slug}?brands=${brand.value.id}`
  return `/catalog/?brandId=${brand.value.id}&categoryId=${category.id}`
}

useHead(() => ({
  title: brand.value ? `${brand.value.name} | Категории бренда` : 'Бренд | Мультитул',
  meta: [
    {
      name: 'description',
      content: brand.value
        ? `Категории и товары бренда ${brand.value.name} в каталоге Мультитул.`
        : 'Категории бренда в каталоге Мультитул.'
    }
  ]
}))
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

    <div v-if="pending" class="loading-state" aria-label="Загружаем бренд">
      <UiSkeleton height="180px" radius="var(--radius-lg)" />
      <div class="categories-grid">
        <UiSkeleton v-for="i in 6" :key="i" height="108px" radius="var(--radius-lg)" />
      </div>
    </div>
    <UiAlert v-else-if="error" tone="danger" title="Не удалось загрузить бренд">
      Обновите страницу или попробуйте позже.
    </UiAlert>
    <UiEmpty v-else-if="!brand" icon="search" title="Бренд не найден" description="Проверьте ссылку или откройте полный список брендов.">
      <UiButton to="/brand/">Все бренды</UiButton>
    </UiEmpty>

    <template v-else>
      <header class="brand-hero">
        <div class="hero-copy">
          <span class="eyebrow">Бренд</span>
          <h1>{{ brand.name }}</h1>
          <p>Выберите категорию или посмотрите все товары этого бренда в каталоге.</p>
          <UiButton class="all-products" :to="'/catalog/?brands=' + brand.id">Все товары бренда →</UiButton>
        </div>
        <div class="hero-stats">
          <div>
            <strong>{{ totalProducts }}</strong>
            <span>товаров</span>
          </div>
          <div>
            <strong>{{ categories.length }}</strong>
            <span>категорий</span>
          </div>
        </div>
      </header>

      <section class="category-section">
        <div class="section-head">
          <h2>Категории бренда</h2>
          <span>{{ categories.length }} разделов</span>
        </div>

        <UiEmpty
          v-if="!categories.length"
          title="Категорий пока нет"
          description="Посмотрите другие бренды или вернитесь в общий каталог."
        >
          <UiButton variant="secondary" to="/brand/">Все бренды</UiButton>
        </UiEmpty>

        <div v-else class="categories-grid">
          <NuxtLink
            v-for="category in categories"
            :key="category.id"
            :to="categoryLink(category)"
            class="category-card"
          >
            <span class="category-monogram" aria-hidden="true">{{ category.name.trim().charAt(0).toLocaleUpperCase('ru') }}</span>
            <span class="category-copy">
              <strong>{{ category.name }}</strong>
              <small>{{ category.count }} товаров</small>
            </span>
            <svg class="card-arrow" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </NuxtLink>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.brand-page,
.loading-state,
.category-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.brand-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-8);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--brand-soft), var(--surface-card) 65%);
  gap: var(--space-6);
}

.hero-copy {
  display: flex;
  max-width: 62ch;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.hero-copy p {
  color: var(--text-muted);
}

.all-products {
  margin-top: var(--space-2);
}

.hero-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.hero-stats > div {
  display: flex;
  min-width: 120px;
  flex-direction: column;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.hero-stats strong {
  color: var(--brand);
  font-size: var(--text-2xl);
  font-weight: 800;
  line-height: 1;
}

.hero-stats span,
.section-head span {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
}

.section-head h2 {
  font-size: var(--text-xl);
}

.categories-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
}

.category-card {
  display: flex;
  min-width: 0;
  min-height: 108px;
  align-items: center;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  gap: var(--space-3);
  transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.category-card:hover,
.category-card:focus-visible {
  border-color: var(--brand);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.category-monogram {
  display: grid;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--brand-soft);
  color: var(--brand);
  font-size: var(--text-xl);
  font-weight: 800;
  place-items: center;
}

.category-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
}

.category-copy strong {
  overflow: hidden;
  color: var(--text-strong);
  font-size: var(--text-md);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-copy small {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.card-arrow {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--text-subtle);
}

.category-card:hover .card-arrow {
  color: var(--brand);
}

@media (max-width: 640px) {
  .brand-hero {
    padding: var(--space-5);
  }

  .hero-stats {
    width: 100%;
  }

  .hero-stats > div {
    flex: 1;
  }
}
</style>
