<script setup lang="ts">
const props = defineProps<{
  page: number
  pages: number
  /** Total items, shown as "N of M" context when provided. */
  total?: number
}>()

const emit = defineEmits<{ change: [page: number] }>()

/** Windowed page list with ellipses: 1 … 4 5 [6] 7 8 … 20 */
const items = computed<Array<number | '…'>>(() => {
  const { page, pages } = props
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)

  const result: Array<number | '…'> = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pages - 1, page + 1)

  if (start > 2) result.push('…')
  for (let i = start; i <= end; i += 1) result.push(i)
  if (end < pages - 1) result.push('…')
  result.push(pages)

  return result
})

function go(page: number) {
  if (page < 1 || page > props.pages || page === props.page) return
  emit('change', page)
}
</script>

<template>
  <nav v-if="pages > 1" class="ui-pagination" aria-label="Постраничная навигация">
    <button
      type="button"
      class="nav"
      :disabled="page <= 1"
      aria-label="Предыдущая страница"
      @click="go(page - 1)"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M12 4l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <template v-for="(item, index) in items" :key="`${item}-${index}`">
      <span v-if="item === '…'" class="gap" aria-hidden="true">…</span>
      <button
        v-else
        type="button"
        class="page"
        :class="{ 'is-current': item === page }"
        :aria-current="item === page ? 'page' : undefined"
        @click="go(item)"
      >
        {{ item }}
      </button>
    </template>

    <button
      type="button"
      class="nav"
      :disabled="page >= pages"
      aria-label="Следующая страница"
      @click="go(page + 1)"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M8 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <span v-if="total != null" class="total">{{ total }} шт.</span>
  </nav>
</template>

<style scoped>
.ui-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}

.page,
.nav {
  display: grid;
  min-width: 38px;
  height: 38px;
  padding: 0 var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-default);
  font-size: var(--text-sm);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  place-items: center;
  transition: background var(--duration-fast) var(--ease-out);
}

.page:hover:not(.is-current),
.nav:hover:not(:disabled) {
  background: var(--surface-active);
}

.is-current {
  border-color: var(--brand);
  background: var(--brand);
  color: var(--text-inverse);
}

.nav svg {
  width: 18px;
  height: 18px;
}

.nav:disabled {
  color: var(--text-subtle);
  cursor: not-allowed;
  opacity: 0.5;
}

.gap {
  padding: 0 var(--space-1);
  color: var(--text-subtle);
}

.total {
  margin-left: var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-sm);
}
</style>
