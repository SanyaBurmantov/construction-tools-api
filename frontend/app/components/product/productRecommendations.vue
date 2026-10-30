<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useProductActions'
import type { FitmentGroup, ProductRecommendations, UpsellSource } from '~/types/api'

/**
 * The product page's upsell blocks, Ozon / Lamoda style: one block per
 * question — «what goes with it» for a tool, «what it fits» for a part — with
 * a chip per group (the stated accessories, then each standard: batteries of
 * the platform, discs of the diameter…) over one sideways shelf, then the
 * similar products. The page fetches the first page on the server (links for
 * crawlers); «Показать ещё» appends the next page to the same shelf.
 */
const props = defineProps<{
  slug: string
  initial: ProductRecommendations | null | undefined
  error?: unknown
}>()
const emit = defineEmits<{ retry: [] }>()

const { apiBase } = useSite()
const toast = useAppToast()
const endpoint = computed(() => `${apiBase}/products/${encodeURIComponent(props.slug)}/recommendations`)

// Under load the API answers 503 rather than fall over; the server-rendered
// page then has no blocks — the browser asks again once it is idle.
onMounted(() => {
  if (props.error && !props.initial) setTimeout(() => emit('retry'), 1500)
})

interface Shelf {
  id: string
  label: string
  source: UpsellSource
  items: CatalogProduct[]
  page: number
  pages: number
  total: number
  /** How to fetch page N of this shelf. */
  next: (page: number) => Promise<{ data: CatalogProduct[] }> // eslint-disable-line no-unused-vars
}

const loaded = ref<Record<string, { items: CatalogProduct[], page: number }>>({})
const loading = ref('')

function explicit(kind: 'accessories' | 'fits', label: string, source: UpsellSource): Shelf | null {
  const list = props.initial?.[kind]
  if (!list?.pagination.total) return null
  const id = kind
  return {
    id,
    label,
    source,
    items: loaded.value[id]?.items ?? list.data,
    page: loaded.value[id]?.page ?? list.pagination.page,
    pages: list.pagination.pages,
    total: list.pagination.total,
    next: async page => (await $fetch<ProductRecommendations>(endpoint.value, {
      params: kind === 'accessories' ? { accessoriesPage: page } : { fitsPage: page },
    }))[kind],
  }
}

function group(item: FitmentGroup, source: UpsellSource): Shelf {
  const id = `${item.role}|${item.key}`
  return {
    id,
    label: item.title,
    source,
    items: loaded.value[id]?.items ?? item.data,
    page: loaded.value[id]?.page ?? item.pagination.page,
    pages: item.pagination.pages,
    total: item.pagination.total,
    next: page => $fetch<FitmentGroup>(`${endpoint.value}/group`, {
      params: { key: item.key, role: item.role, page },
    }),
  }
}

const blocks = computed(() => {
  const value = props.initial
  if (!value) return []
  const goesWith = [
    explicit('accessories', 'К этой модели', 'accessories'),
    ...value.consumables.map(item => group(item, 'consumables')),
  ].filter((shelf): shelf is Shelf => Boolean(shelf))
  const fitsTo = [
    explicit('fits', 'Модели', 'fits'),
    ...value.compatibleTools.map(item => group(item, 'fits')),
  ].filter((shelf): shelf is Shelf => Boolean(shelf))
  return [
    { id: 'goes-with', title: 'Аксессуары и расходники', shelves: goesWith },
    { id: 'fits-to', title: 'Подходит для', shelves: fitsTo },
  ].filter(block => block.shelves.length)
})

const active = ref<Record<string, string>>({})
const current = (block: { id: string, shelves: Shelf[] }) =>
  block.shelves.find(shelf => shelf.id === active.value[block.id]) ?? block.shelves[0]!

async function more(shelf: Shelf) {
  if (loading.value || shelf.page >= shelf.pages) return
  loading.value = shelf.id
  try {
    const page = shelf.page + 1
    const answer = await shelf.next(page)
    const seen = new Set(shelf.items.map(item => item.id))
    loaded.value = {
      ...loaded.value,
      [shelf.id]: { items: [...shelf.items, ...answer.data.filter(item => !seen.has(item.id))], page },
    }
  } catch {
    toast.error('Не удалось загрузить ещё')
  } finally {
    loading.value = ''
  }
}
</script>

<template>
  <div v-if="initial || error" class="recommendations">
    <section v-for="block in blocks" :key="block.id" class="block" :aria-label="block.title">
      <header class="block-head">
        <h2>{{ block.title }}</h2>
        <UiScroller v-if="block.shelves.length > 1" class="chips" :fade="false" label="Группы">
          <button
            v-for="shelf in block.shelves"
            :key="shelf.id"
            type="button"
            class="chip"
            :class="{ 'is-active': current(block).id === shelf.id }"
            :aria-pressed="current(block).id === shelf.id"
            @click="active = { ...active, [block.id]: shelf.id }"
          >
            {{ shelf.label }} <span>{{ shelf.total }}</span>
          </button>
        </UiScroller>
        <p v-else class="single">{{ block.shelves[0]!.label }} · {{ block.shelves[0]!.total }}</p>
      </header>
      <ProductShelf
        :key="current(block).id"
        :items="current(block).items"
        :source="current(block).source"
        :total="current(block).total"
        :has-more="current(block).page < current(block).pages"
        :loading="loading === current(block).id"
        :label="current(block).label"
        @more="more(current(block))"
      />
    </section>

    <section v-if="initial?.similar.length" class="block" aria-label="Похожие товары">
      <header class="block-head">
        <h2>Похожие товары</h2>
      </header>
      <ProductShelf :items="initial.similar" source="similar" label="Похожие товары" />
    </section>

    <p v-if="error && !initial" class="recommendations-error" role="status">
      Не удалось загрузить подборки.
      <UiButton size="sm" variant="ghost" @click="emit('retry')">Повторить</UiButton>
    </p>
  </div>
</template>

<style scoped>
.recommendations {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.block-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

h2 {
  margin: 0;
  font-size: var(--text-2xl);
}

.chips :deep(.viewport) {
  gap: var(--space-2);
}

.chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-default);
  font-size: var(--text-sm);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  gap: var(--space-2);
}

.chip span {
  color: var(--text-subtle);
  font-weight: 500;
}

.chip:hover {
  border-color: var(--border-strong);
}

.chip.is-active {
  border-color: var(--surface-inverse);
  background: var(--surface-inverse);
  color: var(--text-inverse);
}

.chip.is-active span {
  color: inherit;
  opacity: 0.7;
}

.single {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.recommendations-error {
  color: var(--text-muted);
}
</style>
