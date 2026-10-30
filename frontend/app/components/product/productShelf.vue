<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useProductActions'
import type { UpsellSource } from '~/types/api'

/**
 * A row of compact cards that scrolls sideways — Lamoda's and Ozon's shelves:
 * the whole width on a desktop, two cards and a peek on a phone, instead of a
 * grid with a pager under every block. «Показать ещё» at the end loads the
 * next page into the same row.
 */
const props = defineProps<{
  items: CatalogProduct[]
  source: UpsellSource
  /** Total behind the row, for «ещё N». */
  total?: number
  hasMore?: boolean
  loading?: boolean
  label?: string
}>()
const emit = defineEmits<{ more: [] }>()

const left = computed(() => Math.max(0, (props.total ?? 0) - props.items.length))
</script>

<template>
  <UiScroller class="shelf" :label="label">
    <div v-for="item in items" :key="item.id" class="shelf-item">
      <ProductCatalogCard :product="item" :upsell-source="source" compact />
    </div>
    <div v-if="hasMore" class="shelf-item shelf-more">
      <button type="button" :disabled="loading" @click="emit('more')">
        <UiIcon name="chevron-right" :stroke-width="2" />
        <span>{{ loading ? 'Загружаем…' : 'Показать ещё' }}</span>
        <small v-if="left">ещё {{ left }}</small>
      </button>
    </div>
  </UiScroller>
</template>

<style scoped>
.shelf :deep(.viewport) {
  padding: 2px 2px var(--space-2);
  gap: var(--space-4);
  scroll-snap-type: x proximity;
}

.shelf-item {
  flex: 0 0 210px;
  min-width: 0;
  scroll-snap-align: start;
}

.shelf-more {
  display: flex;
}

.shelf-more button {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 240px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  color: var(--text-link);
  font-weight: 600;
  cursor: pointer;
  gap: var(--space-2);
}

.shelf-more button:hover:not(:disabled) {
  background: var(--surface-hover);
}

.shelf-more small {
  color: var(--text-muted);
  font-weight: 400;
}

@media (max-width: 640px) {
  .shelf-item {
    flex-basis: 56vw;
  }
}
</style>
