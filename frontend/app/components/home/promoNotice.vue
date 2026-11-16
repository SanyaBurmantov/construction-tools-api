<script setup lang="ts">
import type { PromoCodeOffer } from '~/types/api'

/**
 * The promo code the shop is advertising right now, first thing on the home
 * page. Fed by `GET /promo-codes/public` — a code an admin marks public shows
 * up here, and an expired or exhausted one drops out on its own, so nobody has
 * to remember to take the strip down.
 *
 * The text is built from the code's terms rather than its admin description:
 * the terms are what checkout enforces, so the strip cannot promise more.
 */
const props = defineProps<{ offer: PromoCodeOffer }>()

const toast = useAppToast()
const copied = ref(false)

const discount = computed(() =>
  props.offer.type === 'PERCENT'
    ? `${props.offer.value}%`
    : formatPrice(props.offer.value, 'BYN')
)

const headline = computed(() => {
  const scope = props.offer.minOrderTotal
    ? `на заказ от ${formatPrice(props.offer.minOrderTotal, 'BYN')}`
    : 'на все заказы'
  const delivery = props.offer.freeDelivery ? ' и бесплатная доставка' : ''
  return `Скидка ${discount.value} ${scope}${delivery}`
})

async function copy() {
  try {
    await navigator.clipboard.writeText(props.offer.code)
    copied.value = true
    toast.success(`Промокод ${props.offer.code} скопирован`)
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // Clipboard blocked (no permission, insecure origin): the code is on screen.
    toast.info('Скопируйте код вручную')
  }
}
</script>

<template>
  <section class="promo" aria-label="Промокод">
    <span class="promo-badge" aria-hidden="true">−{{ discount }}</span>

    <div class="promo-text">
      <p class="promo-headline">{{ headline }}</p>
      <p class="promo-terms">
        Введите промокод <code class="promo-code">{{ offer.code }}</code> при оформлении заказа<template
          v-if="offer.endsAt"
        >. Действует по {{ formatLastDay(offer.endsAt) }} включительно</template>.
      </p>
    </div>

    <UiButton class="promo-copy" variant="secondary" @click="copy">
      <template #leading>
        <UiIcon :name="copied ? 'check' : 'copy'" :size="16" />
      </template>
      {{ copied ? 'Скопировано' : 'Скопировать код' }}
    </UiButton>
  </section>
</template>

<style scoped>
.promo {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-4) var(--space-6);
  border: 1px solid color-mix(in srgb, var(--brand) 25%, var(--border-subtle));
  border-radius: var(--radius-lg);
  background: var(--brand-soft);
}

.promo-badge {
  flex: none;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--brand);
  color: var(--text-inverse);
  font-size: var(--text-xl);
  font-weight: 800;
  line-height: 1;
  white-space: nowrap;
}

.promo-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
}

.promo-headline {
  margin: 0;
  color: var(--text-strong);
  font-size: var(--text-lg);
  font-weight: 700;
  line-height: 1.3;
  text-wrap: balance;
}

.promo-terms {
  margin: 0;
  color: var(--text-default);
  font-size: var(--text-sm);
}

.promo-code {
  padding: 1px var(--space-2);
  border: 1px dashed var(--brand);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--brand-soft-text);
  font-family: inherit;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.promo-copy {
  flex: none;
}

@media (max-width: 640px) {
  .promo {
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .promo-text {
    flex-basis: calc(100% - 96px);
  }

  .promo-copy {
    width: 100%;
  }
}
</style>
