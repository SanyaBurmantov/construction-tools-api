<script setup lang="ts">
import CatalogView from '~/components/catalog/CatalogView.vue'

const route = useRoute()
const categorySlug = computed(() => String(route.params.category || ''))
</script>

<template>
  <CatalogView :key="categorySlug" :category-slug="categorySlug" />
</template>
