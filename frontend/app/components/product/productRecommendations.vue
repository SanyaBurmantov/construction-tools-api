<script setup lang="ts">
import type { ProductRecommendations } from '~/types/api'

const props = defineProps<{ slug: string }>()
const { apiBase } = useSite()

const load = (accessoriesPage: number, fitsPage: number) =>
  $fetch<ProductRecommendations>(`${apiBase}/products/${encodeURIComponent(props.slug)}/recommendations`, {
    params: { accessoriesPage, fitsPage },
  })

// The first page is rendered on the server (links for crawlers); client
// navigation stays lazy.
const { data: initial, error, refresh } = await useAsyncData(
  `recommendations:${props.slug}`,
  () => load(1, 1),
  { lazy: true },
)

// Paging replaces the data in place: a key change would blank the whole block
// (and jump the page) while the next page loads.
const paged = ref<ProductRecommendations | null>(null)
const paging = ref(false)
const data = computed(() => paged.value ?? initial.value)
const toast = useAppToast()

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

async function changePage(key: string, page: number) {
  const current = data.value
  if (!current || paging.value) return
  paging.value = true
  try {
    paged.value = await load(
      key === 'accessories' ? page : current.accessories.pagination.page,
      key === 'fits' ? page : current.fits.pagination.page,
    )
  } catch {
    toast.error('Не удалось загрузить страницу подборки')
  } finally {
    paging.value = false
  }
}
</script>

<template>
  <div v-if="data || error" class="recommendations" :aria-busy="paging">
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
