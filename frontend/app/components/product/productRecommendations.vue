<script setup lang="ts">
import type { ProductRecommendations } from '~/types/api'

const props = defineProps<{ slug: string }>()
const { apiBase } = useSite()
const accessoriesPage = ref(1)
const fitsPage = ref(1)

const { data, status, error, refresh } = await useAsyncData<ProductRecommendations>(
  () => `recommendations:${props.slug}:${accessoriesPage.value}:${fitsPage.value}`,
  () => $fetch(`${apiBase}/products/${encodeURIComponent(props.slug)}/recommendations`, {
    params: { accessoriesPage: accessoriesPage.value, fitsPage: fitsPage.value },
  }),
  // Client navigation stays lazy; initial SSR can render the product links.
  { lazy: true },
)

const sections = computed(() => [
  {
    key: 'accessories', title: 'Аксессуары и расходники',
    items: data.value?.accessories.data ?? [],
    pagination: data.value?.accessories.pagination,
  },
  {
    key: 'fits', title: 'Подходит для',
    items: data.value?.fits.data ?? [],
    pagination: data.value?.fits.pagination,
  },
  {
    key: 'similar', title: 'Похожие товары',
    items: data.value?.similar ?? [], pagination: undefined,
  },
])

function changePage(key: string, page: number) {
  if (key === 'accessories') accessoriesPage.value = page
  if (key === 'fits') fitsPage.value = page
}
</script>

<template>
  <div v-if="data || error" class="recommendations" :aria-busy="status === 'pending'">
    <section v-for="section in sections.filter(value => value.items.length)" :key="section.key" :aria-label="section.title">
      <h2>{{ section.title }}</h2>
      <div class="product-grid">
        <ProductCatalogCard v-for="item in section.items" :key="item.id" :product="item" compact />
      </div>
      <UiPagination
        v-if="section.pagination && section.pagination.pages > 1"
        :page="section.pagination.page"
        :pages="section.pagination.pages"
        :total="section.pagination.total"
        @change="changePage(section.key, $event)"
      />
    </section>
    <p v-if="error" class="recommendations-error" role="status">
      Не удалось загрузить подборки.
      <UiButton size="sm" variant="ghost" @click="refresh()">Повторить</UiButton>
    </p>
  </div>
</template>

<style scoped>
.recommendations,
section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.recommendations {
  gap: var(--space-10);
}

h2 {
  margin: 0;
  font-size: var(--text-2xl);
}

.recommendations-error {
  color: var(--text-muted);
}
</style>
