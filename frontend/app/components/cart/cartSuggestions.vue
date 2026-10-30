<script setup lang="ts">
import type { CartSuggestion } from '~/types/api'
import { useCartStore } from '~/stores/cart'

/**
 * «Не забудьте к заказу»: what the cart's tools take — the accessories stated
 * for them, then the consumables by standard (discs for a 125 mm grinder,
 * batteries of its platform). The moment of purchase is where an add-on sells.
 */
const cart = useCartStore()
const { apiBase } = useSite()

const ids = computed(() => cart.items.map((item) => item.productId).sort().slice(0, 50).join(','))
const suggestions = ref<CartSuggestion[]>([])

let timer: ReturnType<typeof setTimeout> | undefined
let request = 0
async function load(value: string) {
  const id = ++request
  if (!value) {
    suggestions.value = []
    return
  }
  try {
    const answer = await $fetch<{ data: CartSuggestion[] }>(`${apiBase}/recommendations/cart`, {
      params: { ids: value },
    })
    // A later cart change already asked again: its answer wins.
    if (id === request) suggestions.value = answer.data
  } catch {
    // An extra, not the cart: a failure shows nothing.
    if (id === request) suggestions.value = []
  }
}

// Quantity edits do not change the ids; adding a suggestion does, once.
watch(ids, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => load(value), 400)
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <section v-if="suggestions.length" class="suggestions" aria-label="Не забудьте к заказу">
    <h2>Не забудьте к заказу</h2>
    <div class="product-grid">
      <div v-for="item in suggestions" :key="item.product.id" class="suggestion">
        <p class="reason">{{ item.reason }}</p>
        <ProductCatalogCard :product="item.product" upsell-source="cart" compact />
      </div>
    </div>
  </section>
</template>

<style scoped>
.suggestions {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

h2 {
  margin: 0;
  font-size: var(--text-2xl);
}

.suggestion {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: var(--space-2);
}

.reason {
  overflow: hidden;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
