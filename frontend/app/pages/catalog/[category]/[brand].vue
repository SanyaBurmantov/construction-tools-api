<script setup lang="ts">
/**
 * A «категория + бренд» landing — «Перфораторы Makita» at
 * `/catalog/perforatory/makita` — written by the AI assistant: its own
 * heading, text, SEO and canonical over the category filtered by the brand.
 * No published landing (hidden since, or never written) → the plain filtered
 * view `/catalog/<category>?brands=<id>`, temporarily (it may come back).
 */
import type { BrandCategoriesResponse, CatalogLanding } from '~/types/api'

definePageMeta({
  validate: route =>
    /^[a-z0-9-]{1,200}$/.test(String(route.params.category))
    && /^[a-z0-9-]{1,200}$/.test(String(route.params.brand)),
})

const route = useRoute()
const { apiBase } = useSite()
const categorySlug = computed(() => String(route.params.category || ''))
const brandSlug = computed(() => String(route.params.brand || ''))

const { data: landing, error } = await useAsyncData<CatalogLanding | null>(
  () => `catalog-landing-page:${categorySlug.value}:${brandSlug.value}`,
  () => $fetch<CatalogLanding>(`${apiBase}/storefront/landing`, {
    params: { category: categorySlug.value, brand: brandSlug.value },
  }).catch((failure) => {
    if (isApiUnavailable(failure)) throw failure
    return null
  }),
)

if (error.value) throw apiUnavailableError()

if (!landing.value) {
  const brand = await $fetch<BrandCategoriesResponse>(
    `${apiBase}/brands/${encodeURIComponent(brandSlug.value)}/categories`,
  ).catch(() => null)
  if (!brand?.brand?.id) {
    throw createError({ statusCode: 404, statusMessage: 'Страница не найдена', fatal: true })
  }
  await navigateTo(
    { path: `/catalog/${categorySlug.value}`, query: { ...route.query, brands: brand.brand.id } },
    { redirectCode: 302, replace: true },
  )
}
</script>

<template>
  <CatalogView
    v-if="landing"
    :key="`${categorySlug}:${brandSlug}`"
    :category-slug="categorySlug"
    :landing="landing"
  />
</template>
