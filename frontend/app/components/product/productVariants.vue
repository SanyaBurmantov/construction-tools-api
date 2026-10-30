<script setup lang="ts">
import type { VariantOption } from '~/types/api'

/**
 * Other sizes of the same line — «6 мм · 8 мм · 12 мм» of one drill — each its
 * own page (people search for «бур 8 мм»), linked from the current one. A long
 * list of two-part sizes («М10х100 мм») is laid out as rows by the first part,
 * so 150 bolt sizes read as a table: «М10 — 20 30 40 … 100».
 */
const props = defineProps<{ variants: VariantOption[] }>()

const LIMIT = 24
const ROWS_FROM = 12
const expanded = ref(false)

const SPLIT = /^(.+?)\s?[хx×]\s?(.+)$/u
const rows = computed(() => {
  if (props.variants.length < ROWS_FROM) return null
  const parts = props.variants.map((variant) => SPLIT.exec(variant.label))
  if (parts.some((part) => !part)) return null
  const byHead = new Map<string, Array<{ variant: VariantOption, tail: string }>>()
  props.variants.forEach((variant, index) => {
    const [, head, tail] = parts[index]!
    byHead.set(head!, [...(byHead.get(head!) ?? []), { variant, tail: tail! }])
  })
  // Rows only help when they actually group: several sizes per head.
  return byHead.size > 1 && byHead.size < props.variants.length / 2 ? [...byHead] : null
})

const shown = computed(() => {
  if (expanded.value || props.variants.length <= LIMIT) return props.variants
  // Keep the current size visible when the row is cut.
  const first = props.variants.slice(0, LIMIT)
  const current = props.variants.find((variant) => variant.current)
  return current && !first.includes(current) ? [...first.slice(0, LIMIT - 1), current] : first
})
// A long table opens at the current size, not at the smallest one.
const rowsBox = ref<HTMLElement | null>(null)
onMounted(() => {
  const box = rowsBox.value
  const current = box?.querySelector<HTMLElement>('[aria-current="page"]')
  if (box && current) box.scrollTop = Math.max(0, current.offsetTop - box.offsetTop - box.clientHeight / 2)
})

const hint = (variant: VariantOption) =>
  [
    variant.priceValue != null ? formatPrice(variant.priceValue, 'BYN') : null,
    variant.stockStatus === 'in_stock' ? 'в наличии' : 'под заказ',
  ]
    .filter(Boolean)
    .join(', ')
</script>

<template>
  <nav class="variants" aria-label="Другие размеры">
    <h2>Варианты</h2>

    <dl v-if="rows" ref="rowsBox" class="rows">
      <div v-for="[head, items] in rows" :key="head" class="row">
        <dt>{{ head }}</dt>
        <dd>
          <template v-for="{ variant, tail } in items" :key="variant.slug">
            <span v-if="variant.current" class="chip is-current" aria-current="page">{{ tail }}</span>
            <NuxtLink
              v-else
              :to="`/product/${variant.slug}`"
              class="chip"
              :class="{ 'is-out': variant.stockStatus !== 'in_stock' }"
              :title="`${variant.label}: ${hint(variant)}`"
            >
              {{ tail }}
            </NuxtLink>
          </template>
        </dd>
      </div>
    </dl>

    <ul v-else>
      <li v-for="variant in shown" :key="variant.slug">
        <span v-if="variant.current" class="chip is-current" aria-current="page">{{ variant.label }}</span>
        <NuxtLink
          v-else
          :to="`/product/${variant.slug}`"
          class="chip"
          :class="{ 'is-out': variant.stockStatus !== 'in_stock' }"
          :title="hint(variant)"
        >
          {{ variant.label }}
        </NuxtLink>
      </li>
      <li v-if="!expanded && variants.length > LIMIT">
        <button type="button" class="chip more" @click="expanded = true">
          Ещё {{ variants.length - shown.length }}
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.variants {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

h2 {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 700;
}

ul,
dd {
  display: flex;
  flex-wrap: wrap;
  margin: 0;
  padding: 0;
  list-style: none;
  gap: var(--space-2);
}

.rows {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  max-height: 320px;
  margin: 0;
  gap: var(--space-2);
}

.row {
  display: grid;
  align-items: start;
  gap: var(--space-2);
  grid-template-columns: 56px 1fr;
}

dt {
  padding-top: 6px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 700;
}

.chip {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-default);
  font-size: var(--text-sm);
  text-decoration: none;
  white-space: nowrap;
}

a.chip:hover {
  border-color: var(--border-strong);
}

.chip.is-current {
  border-color: var(--text-link);
  box-shadow: inset 0 0 0 1px var(--text-link);
  font-weight: 700;
}

.chip.is-out {
  color: var(--text-subtle);
}

.chip.more {
  color: var(--text-link);
  cursor: pointer;
}
</style>
