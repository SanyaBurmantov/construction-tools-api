<script setup lang="ts">
// Slugs are `[a-z0-9-]` (prod has no other), and anything else 404s before
// a fetch: `/product/..%2Fprice-list.xlsx` used to send SSR — unthrottled,
// from the private network — to any backend GET (audit 2026-10-30).
definePageMeta({
  validate: route => /^[a-z0-9-]{1,200}$/.test(String(route.params.category)),
})

const route = useRoute()
const categorySlug = computed(() => String(route.params.category || ''))
</script>

<template>
  <CatalogView :key="categorySlug" :category-slug="categorySlug" />
</template>
