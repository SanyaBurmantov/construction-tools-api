<script setup lang="ts">
import type { PackOption } from '~/types/api'
import { useCartStore } from '~/stores/cart'

/**
 * The same item in other packs, priced per piece/kg — a buyer for a company
 * takes the box once they see the box is cheaper per screw.
 */
const props = defineProps<{ packs: PackOption[] }>()

const cart = useCartStore()
const toast = useAppToast()

const current = computed(() => props.packs.find((pack) => pack.current))
const perUnit = (value: number, currency: string | null) =>
  new Intl.NumberFormat('ru-BY', {
    style: 'currency',
    currency: normalizeCurrency(currency),
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value)
/** How much cheaper per unit than the pack on this page, in whole percent. */
const saving = (pack: PackOption) => {
  const base = current.value?.unitPrice
  if (!base || pack.current || pack.unitPrice >= base) return 0
  return Math.round((1 - pack.unitPrice / base) * 100)
}

function add(pack: PackOption) {
  cart.add({
    productId: pack.id,
    slug: pack.slug,
    name: pack.name,
    image: pack.image,
    price: pack.priceValue,
    currency: normalizeCurrency(pack.priceCurrency),
    upsellSource: 'packs',
  })
  toast.success(`«${pack.name}» в корзине`)
}
</script>

<template>
  <section class="packs" aria-label="Другие фасовки">
    <h2>Фасовки</h2>
    <ul>
      <li v-for="pack in packs" :key="pack.id" :class="{ 'is-current': pack.current }">
        <span v-if="pack.current" class="size">{{ pack.quantity }} {{ pack.unit }}</span>
        <NuxtLink v-else :to="`/product/${pack.slug}`" class="size">{{ pack.quantity }} {{ pack.unit }}</NuxtLink>
        <span class="unit">{{ perUnit(pack.unitPrice, pack.priceCurrency) }}/{{ pack.unit }}</span>
        <span v-if="saving(pack)" class="saving">−{{ saving(pack) }}%</span>
        <span v-else class="saving" aria-hidden="true" />
        <span v-if="pack.current" class="here">эта</span>
        <button v-else type="button" class="add" :aria-label="`В корзину: ${pack.quantity} ${pack.unit}`" @click="add(pack)">
          <UiIcon name="cart" />
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.packs {
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

ul {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  gap: var(--space-1);
}

li {
  display: grid;
  align-items: center;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  gap: var(--space-2);
  grid-template-columns: minmax(64px, auto) 1fr auto 32px;
}

li.is-current {
  background: var(--surface-sunken);
  font-weight: 700;
}

.size {
  color: var(--text-default);
}

a.size {
  color: var(--text-link);
}

.unit {
  color: var(--text-muted);
}

.saving {
  color: var(--success);
  font-weight: 700;
}

.here {
  color: var(--text-subtle);
  font-size: var(--text-xs);
  text-align: center;
}

.add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-default);
  cursor: pointer;
}

.add:hover {
  border-color: var(--border-strong);
}
</style>
