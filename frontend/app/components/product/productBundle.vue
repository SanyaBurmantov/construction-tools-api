<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useProductActions'
import { toCartLine } from '~/composables/useProductActions'
import type { ProductRecommendations, UpsellSource } from '~/types/api'
import { useCartStore } from '~/stores/cart'

/**
 * «Покупают вместе» in the buy box — Ozon's and Yandex Market's bundle: this
 * product plus the first thing each upsell group offers (the accessory stated
 * for this model, a battery of its platform, the bits it takes…), ticked by
 * default, with the total and one button for all of it.
 */
const props = defineProps<{
  product: CatalogProduct
  recommendations: ProductRecommendations
}>()

const cart = useCartStore()
const toast = useAppToast()
const MAX = 3

/** Weighed (кг) with weighed, counted with counted; all of them if none match. */
const byKg = (name: string) => /\(\s*[\d.,]+\s*кг/i.test(name)
function sameUnit(items: CatalogProduct[]) {
  const kg = byKg(props.product.name)
  const matching = items.filter(item => byKg(item.name) === kg)
  return matching.length ? matching : items
}

const offers = computed(() => {
  const picked: Array<{ item: CatalogProduct, source: UpsellSource, reason: string }> = []
  const take = (items: CatalogProduct[], source: UpsellSource, reason: string, prefer?: RegExp) => {
    const usable = items.filter(item => item.priceValue && item.id !== props.product.id)
    const inStock = usable.filter(row => row.stockStatus === 'in_stock')
    const pool = inStock.length ? inStock : usable
    const item = (prefer && pool.find(row => prefer.test(row.name))) ?? pool[0]
    if (item && !picked.some(row => row.item.id === item.id))
      picked.push({ item, source, reason })
  }
  take(props.recommendations.accessories.data, 'accessories', 'к этой модели')
  for (const group of props.recommendations.consumables) {
    if (group.key.startsWith('thread:')) {
      // A bolt goes with a nut and a washer — in the same kind of pack.
      take(sameUnit(group.data), 'consumables', group.title, /^гайк/i)
      take(sameUnit(group.data), 'consumables', group.title, /^шайб/i)
      continue
    }
    // A tool sold without a battery needs the battery first, not the charger.
    take(group.data, 'consumables', group.title, group.key.startsWith('battery:') ? /^аккумулятор/i : undefined)
  }
  return picked.slice(0, MAX)
})

const ticked = ref<Record<string, boolean>>({})
const isTicked = (id: string) => ticked.value[id] ?? true

const total = computed(() =>
  (props.product.priceValue ?? 0)
  + offers.value.reduce((sum, row) => sum + (isTicked(row.item.id) ? row.item.priceValue ?? 0 : 0), 0))
const count = computed(() => 1 + offers.value.filter(row => isTicked(row.item.id)).length)

function addAll() {
  const main = toCartLine(props.product)
  if (!main) return
  if (!cart.items.some(line => line.productId === props.product.id)) cart.add({ ...main, upsellSource: '' })
  for (const row of offers.value) {
    if (!isTicked(row.item.id)) continue
    const line = toCartLine(row.item)
    if (line && !cart.items.some(existing => existing.productId === row.item.id))
      cart.add({ ...line, upsellSource: row.source })
  }
  toast.success(`Комплект в корзине: ${pluralize(count.value, 'position')}`)
}
</script>

<template>
  <section v-if="offers.length" class="bundle" aria-label="Покупают вместе">
    <h2>Покупают вместе</h2>
    <ul>
      <li v-for="row in offers" :key="row.item.id">
        <UiCheckbox :model-value="isTicked(row.item.id)" @update:model-value="ticked = { ...ticked, [row.item.id]: Boolean($event) }">
          <span class="sr-only">Добавить в комплект</span>
        </UiCheckbox>
        <NuxtLink :to="`/product/${row.item.slug}`" class="thumb">
          <ProductThumb :src="row.item.images?.[0]?.url" :alt="row.item.name" :width="44" />
        </NuxtLink>
        <div class="info">
          <NuxtLink :to="`/product/${row.item.slug}`" class="name">{{ row.item.name }}</NuxtLink>
          <span class="reason">{{ row.reason }}</span>
        </div>
        <strong class="price">{{ formatPrice(row.item.priceValue, row.item.priceCurrency) }}</strong>
      </li>
    </ul>
    <UiButton block variant="secondary" @click="addAll">
      Добавить комплект · {{ formatPrice(total, product.priceCurrency) }}
    </UiButton>
  </section>
</template>

<style scoped>
.bundle {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-3);
}

h2 {
  margin: 0;
  font-size: var(--text-base);
}

ul {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  gap: var(--space-2);
}

li {
  display: grid;
  align-items: center;
  gap: var(--space-3);
  grid-template-columns: auto 44px minmax(0, 1fr) auto;
}

.thumb {
  display: grid;
  overflow: hidden;
  width: 44px;
  height: 44px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-subtle);
  place-items: center;
}


.info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.name {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-default);
  font-size: var(--text-sm);
  line-height: 1.3;
  text-decoration: none;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.name:hover {
  color: var(--text-link);
}

.reason {
  overflow: hidden;
  color: var(--text-subtle);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.price {
  font-size: var(--text-sm);
  white-space: nowrap;
}

.sr-only {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  clip: rect(0 0 0 0);
}
</style>
