<script setup lang="ts">
/**
 * Promo code input / applied-code chip, shared by the cart and the checkout.
 * The applied code lives in `usePromoCode()` state, so it carries over between
 * the two screens; this only owns the text being typed.
 */
withDefaults(
  defineProps<{
    /** Smaller controls for the narrower checkout summary. */
    compact?: boolean
  }>(),
  { compact: false }
)

const promo = usePromoCode()
const toast = useAppToast()
const input = ref('')

// Rendered only once the cart has lines, so the restore below sees them.
onMounted(async () => {
  await promo.restore()
  input.value = promo.code.value
})
promo.watchCartTotal()

async function apply() {
  const ok = await promo.validate(input.value)
  if (ok) toast.success(`Промокод ${promo.code.value} применён`)
}

function remove() {
  promo.clear()
  input.value = ''
}
</script>

<template>
  <UiField label="Промокод" :error="promo.error.value">
    <div v-if="!promo.preview.value" class="promo-input">
      <UiInput
        v-model="input"
        placeholder="Введите код"
        :size="compact ? 'sm' : 'md'"
        :invalid="Boolean(promo.error.value)"
        @keydown.enter.prevent="apply"
      />
      <UiButton
        variant="secondary"
        :size="compact ? 'sm' : 'md'"
        :loading="promo.validating.value"
        @click="apply"
      >
        {{ compact ? 'ОК' : 'Применить' }}
      </UiButton>
    </div>
    <div v-else class="promo-applied">
      <div>
        <code>{{ promo.preview.value.code }}</code>
        <span v-if="promo.preview.value.freeDelivery">+ бесплатная доставка</span>
      </div>
      <button type="button" aria-label="Убрать промокод" @click="remove">✕</button>
    </div>
  </UiField>
</template>

<style scoped>
.promo-input {
  display: flex;
  gap: var(--space-2);
}

.promo-applied {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--success-soft);
  border-radius: var(--radius-sm);
  background: var(--success-soft);
  gap: var(--space-2);
}

.promo-applied > div {
  display: flex;
  flex-direction: column;
}

.promo-applied code {
  color: var(--success-soft-text);
  font-family: var(--font-mono);
  font-weight: 700;
}

.promo-applied span {
  color: var(--success-soft-text);
  font-size: var(--text-xs);
}

.promo-applied button {
  color: var(--success-soft-text);
}
</style>
