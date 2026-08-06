<script setup lang="ts">
/**
 * Price with optional strikethrough original and a discount badge.
 * `oldPrice` is only honoured when it genuinely exceeds `value`.
 */
const props = withDefaults(
  defineProps<{
    value?: number | null
    oldPrice?: number | null
    currency?: string | null
    size?: 'sm' | 'md' | 'lg'
    showBadge?: boolean
  }>(),
  { size: 'md', showBadge: true }
)

const { formatPrice } = useFormatPrice()

const hasDiscount = computed(
  () => props.oldPrice != null && props.value != null && props.oldPrice > props.value
)

const discountPercent = computed(() => {
  if (!hasDiscount.value) return 0
  return Math.round((1 - (props.value as number) / (props.oldPrice as number)) * 100)
})
</script>

<template>
  <div class="ui-price" :class="[`size-${size}`, { 'has-discount': hasDiscount }]">
    <span class="current">{{ formatPrice(value, currency) }}</span>
    <span v-if="hasDiscount" class="old">{{ formatPrice(oldPrice, currency) }}</span>
    <UiBadge v-if="hasDiscount && showBadge" tone="sale" size="sm">
      −{{ discountPercent }}%
    </UiBadge>
  </div>
</template>

<style scoped>
.ui-price {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}

.current {
  color: var(--text-strong);
  font-weight: 800;
  letter-spacing: var(--tracking-tight);
  font-variant-numeric: tabular-nums;
}

.has-discount .current {
  color: var(--sale);
}

.old {
  color: var(--text-subtle);
  text-decoration: line-through;
  font-variant-numeric: tabular-nums;
}

.size-sm .current {
  font-size: var(--text-md);
}

.size-sm .old {
  font-size: var(--text-xs);
}

.size-md .current {
  font-size: var(--text-xl);
}

.size-md .old {
  font-size: var(--text-sm);
}

.size-lg .current {
  font-size: var(--text-3xl);
}

.size-lg .old {
  font-size: var(--text-md);
}
</style>
