<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useProductActions'
import type {
  FitmentGroup,
  Pagination,
  ProductRecommendations,
  UpsellSource,
} from '~/types/api'

// The page fetches the first page (SSR — links for crawlers; the buy box
// shows its packs from the same answer); paging happens here, in place.
const props = defineProps<{
  slug: string
  initial: ProductRecommendations | null | undefined
  error?: unknown
}>()
const emit = defineEmits<{ retry: [] }>()

const { apiBase } = useSite()
const toast = useAppToast()
const endpoint = computed(() => `${apiBase}/products/${encodeURIComponent(props.slug)}/recommendations`)

// A key change would blank the whole block (and jump the page) while the next
// page loads, so pages replace their own section's data.
const paged = ref<ProductRecommendations | null>(null)
const groupPages = ref<Record<string, FitmentGroup>>({})
const paging = ref(false)
const data = computed(() => paged.value ?? props.initial)

// Under load the API answers 503 rather than fall over; the server-rendered
// page then has no blocks — the browser asks again once it is idle.
onMounted(() => {
  if (props.error && !props.initial) setTimeout(() => emit('retry'), 1500)
})

interface Section {
  id: string
  title: string
  items: CatalogProduct[]
  pagination?: Pagination
  source: UpsellSource
  group?: FitmentGroup
}

const groupId = (group: FitmentGroup) => `${group.role}|${group.key}`
const current = (group: FitmentGroup) => groupPages.value[groupId(group)] ?? group

const sections = computed<Section[]>(() => {
  const value = data.value
  if (!value) return []
  const groups = (list: FitmentGroup[] | undefined, source: UpsellSource, prefix = '') =>
    (list ?? []).map(current).map((group) => ({
      id: groupId(group),
      title: `${prefix}${group.title}`,
      items: group.data,
      pagination: group.pagination,
      source,
      group,
    }))
  return [
    {
      id: 'accessories',
      title: 'Аксессуары к этой модели',
      items: value.accessories.data,
      pagination: value.accessories.pagination,
      source: 'accessories',
    },
    ...groups(value.consumables, 'consumables'),
    {
      id: 'fits',
      title: 'Подходит для',
      items: value.fits.data,
      pagination: value.fits.pagination,
      source: 'fits',
    },
    ...groups(value.compatibleTools, 'fits', 'Подходит к: '),
    { id: 'similar', title: 'Похожие товары', items: value.similar, source: 'similar' },
  ].filter((section) => section.items.length) as Section[]
})

async function changePage(section: Section, page: number) {
  const value = data.value
  if (!value || paging.value) return
  paging.value = true
  try {
    if (section.group) {
      groupPages.value = {
        ...groupPages.value,
        [section.id]: await $fetch<FitmentGroup>(`${endpoint.value}/group`, {
          params: { key: section.group.key, role: section.group.role, page },
        }),
      }
    } else {
      paged.value = await $fetch<ProductRecommendations>(endpoint.value, {
        params: {
          accessoriesPage: section.id === 'accessories' ? page : value.accessories.pagination.page,
          fitsPage: section.id === 'fits' ? page : value.fits.pagination.page,
        },
      })
    }
  } catch {
    toast.error('Не удалось загрузить страницу подборки')
  } finally {
    paging.value = false
  }
}
</script>

<template>
  <div v-if="data || error" class="recommendations" :aria-busy="paging">
    <section v-for="section in sections" :key="section.id" :aria-label="section.title">
      <h2>
        {{ section.title }}
        <span v-if="section.pagination && section.pagination.total > section.items.length" class="count">
          {{ section.pagination.total }}
        </span>
      </h2>
      <div class="product-grid">
        <ProductCatalogCard
          v-for="item in section.items"
          :key="item.id"
          :product="item"
          :upsell-source="section.source"
          compact
        />
      </div>
      <UiPagination
        v-if="section.pagination && section.pagination.pages > 1"
        :page="section.pagination.page"
        :pages="section.pagination.pages"
        :total="section.pagination.total"
        @change="changePage(section, $event)"
      />
    </section>
    <p v-if="error && !data" class="recommendations-error" role="status">
      Не удалось загрузить подборки.
      <UiButton size="sm" variant="ghost" @click="emit('retry')">Повторить</UiButton>
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
  display: flex;
  align-items: baseline;
  margin: 0;
  font-size: var(--text-2xl);
  gap: var(--space-2);
}

.count {
  color: var(--text-subtle);
  font-size: var(--text-base);
  font-weight: 600;
}

.recommendations-error {
  color: var(--text-muted);
}
</style>
