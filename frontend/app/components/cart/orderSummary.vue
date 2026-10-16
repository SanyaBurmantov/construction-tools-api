<script setup lang="ts">
import { useCartStore } from '~/stores/cart'

/**
 * The sticky totals card beside the cart and the checkout form: promo code,
 * subtotal, discount, optional delivery and the grand total. A preview only —
 * POST /orders recomputes every number server-side.
 *
 * Slots: `lines` above the promo field (checkout's item list), default below
 * the totals (notes, alerts, the action buttons).
 */
const props = withDefaults(
  defineProps<{
    title: string
    totalLabel: string
    /** Omitted on the cart, where delivery is not chosen yet. */
    deliveryCost?: number | null
    compact?: boolean
  }>(),
  { deliveryCost: null, compact: false }
)

const cart = useCartStore()
const promo = usePromoCode()
const { formatPrice } = useFormatPrice()

const total = computed(() =>
  Math.max(
    0,
    Math.round((cart.totalPrice - promo.discount.value + (props.deliveryCost ?? 0)) * 100) / 100
  )
)
</script>

<template>
  <aside class="summary">
    <div class="summary-card">
      <h2>{{ title }}</h2>

      <slot name="lines" />

      <CartPromoCodeField :compact="compact" />

      <dl class="totals">
        <div>
          <dt>Товары ({{ cart.count }})</dt>
          <dd>{{ formatPrice(cart.totalPrice, cart.currency) }}</dd>
        </div>
        <div v-if="promo.discount.value" class="is-discount">
          <dt>Скидка ({{ promo.code.value }})</dt>
          <dd>−{{ formatPrice(promo.discount.value, cart.currency) }}</dd>
        </div>
        <div v-if="deliveryCost != null">
          <dt>
            Доставка<template v-if="promo.freeDelivery.value"> (по промокоду)</template>
          </dt>
          <dd>{{ deliveryCost ? formatPrice(deliveryCost, cart.currency) : 'бесплатно' }}</dd>
        </div>
        <div class="is-total">
          <dt>{{ totalLabel }}</dt>
          <dd>{{ formatPrice(total, cart.currency) }}</dd>
        </div>
      </dl>

      <slot />
    </div>
  </aside>
</template>

<style scoped>
.summary {
  position: sticky;
  top: calc(var(--header-height) + var(--space-4));
}

.summary-card {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  gap: var(--space-4);
}

.summary-card h2 {
  font-size: var(--text-lg);
}

.totals {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-4);
  margin: 0;
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-2);
}

.totals > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.totals dd {
  margin: 0;
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.totals .is-discount,
.totals .is-discount dd {
  color: var(--sale);
  font-weight: 600;
}

.totals .is-total {
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-strong);
  font-size: var(--text-lg);
  font-weight: 800;
}

@media (max-width: 1000px) {
  .summary {
    position: static;
  }
}
</style>
