<script setup lang="ts">
import type { BrandCategoriesResponse, BrandCategory } from '~/types/api'

const route = useRoute()
const { apiBase, absoluteUrl } = useSite()
const slug = computed(() => String(route.params.slug || ''))

const { data, status, error } = await useAsyncData<BrandCategoriesResponse>(
  () => `brand-categories:${slug.value}`,
  // The key follows the slug, so no `watch` is needed to re-fetch.
  () => $fetch<BrandCategoriesResponse>(`${apiBase}/brands/${slug.value}/categories`)
)

if (error.value) {
  // «Не ответило» is not «нет такого бренда» — see the product page.
  if (isApiUnavailable(error.value)) throw apiUnavailableError()
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
  if (!brand.value?.id) return '/catalog'
  if (category.slug) return `/catalog/${category.slug}?brands=${brand.value.id}`
  return `/catalog?brands=${brand.value.id}&categoryId=${category.id}`
}

const allProductsLink = computed(() =>
  brand.value?.id ? `/catalog?brands=${brand.value.id}` : '/catalog'
)

const heroStats = computed(() => [
  { value: totalProducts.value, label: plural(totalProducts.value, ...PLURALS.product) },
  { value: categories.value.length, label: plural(categories.value.length, ...PLURALS.category) },
])

const description = computed(() =>
  brand.value
    ? `Товары бренда ${brand.value.name} в каталоге Gost.by: ${pluralize(totalProducts.value, 'position')} в ${pluralize(categories.value.length, 'categoryIn')}.`
    : 'Категории бренда в каталоге Gost.by.'
)
const canonical = computed(() => absoluteUrl(`/brand/${slug.value}`))

useSeoMeta({
  title: () => (brand.value ? `${brand.value.name} | Gost.by` : 'Бренд | Gost.by'),
  description: () => description.value,
  ogTitle: () => (brand.value ? `${brand.value.name} | Gost.by` : 'Бренд | Gost.by'),
  ogDescription: () => description.value,
  ogType: 'website',
  ogUrl: () => canonical.value,
})

// A getter, so the canonical follows the slug when the page is reused.
useHead(() => ({ link: [{ rel: 'canonical', href: canonical.value }] }))
</script>

<template>
  <div class="brand-page">
    <UiBreadcrumbs
      :items="[
        { label: 'Главная', to: '/' },
        { label: 'Бренды', to: '/brand' },
        { label: brand?.name || 'Бренд' }
      ]"
    />

    <StorefrontPageHero eyebrow="Бренд" :title="brand?.name" :stats="heroStats">
      <p>Выберите категорию, чтобы открыть каталог с товарами этого бренда.</p>
      <div class="hero-actions">
        <UiButton :to="allProductsLink" size="sm">Все товары бренда</UiButton>
        <UiButton to="/brand" variant="secondary" size="sm">Все бренды</UiButton>
      </div>
    </StorefrontPageHero>

    <div v-if="status === 'pending'" class="grid">
      <UiSkeleton v-for="i in 6" :key="i" height="96px" radius="var(--radius-md)" />
    </div>

    <UiEmpty
      v-else-if="!categories.length"
      icon="box"
      title="У этого бренда пока нет товаров"
      description="Товары появятся здесь, как только они попадут в каталог."
    >
      <UiButton to="/catalog">Перейти в каталог</UiButton>
    </UiEmpty>

    <section v-else class="grid">
      <UiCategoryCard
        v-for="category in categories"
        :key="category.id"
        :name="category.name"
        :to="categoryLink(category)"
        :count="category.count"
        variant="row"
      />
    </section>
  </div>
</template>

<style scoped>
.brand-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.grid {
  display: grid;
  /* 260px is wider than the page container on the narrowest phones, and a bare
     minmax() floor overflows rather than collapsing to one column. */
  grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
  gap: var(--space-3);
}
</style>
