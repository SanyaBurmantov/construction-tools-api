<script setup lang="ts">
const route = useRoute()
const categorySlug = computed(() => String(route.params.category || ''))
</script>

<template>
  <CatalogView :key="categorySlug" :category-slug="categorySlug" />
</template>
