<script setup lang="ts">
/**
 * Warnings raised by re-pricing the cart against the API: prices that moved,
 * products that disappeared, items now on backorder.
 */
withDefaults(
  defineProps<{
    /** Hides the fix-it buttons where the cart isn't editable. */
    readonly?: boolean
  }>(),
  { readonly: false }
)

const {
  changedItems,
  unavailableItems,
  backorderItems,
  acceptPrices,
  removeUnavailable,
} = useCartValidation()
const { formatPrice } = useFormatPrice()

const busy = ref(false)

async function onAccept() {
  busy.value = true
  await acceptPrices()
  busy.value = false
}

async function onRemove() {
  busy.value = true
  await removeUnavailable()
  busy.value = false
}

function direction(clientPrice: number | null, price: number | null) {
  if (clientPrice == null || price == null) return ''
  return price > clientPrice ? 'выросла' : 'снизилась'
}
</script>

<template>
  <div v-if="changedItems.length || unavailableItems.length || backorderItems.length" class="cart-issues">
    <UiAlert v-if="unavailableItems.length" tone="danger" title="Товары больше не доступны">
      <span>
        {{ unavailableItems.map((i) => i.name || 'товар').join(', ') }} —
        сняты с продажи или цена не указана. Оформить заказ с ними не получится.
      </span>
      <template v-if="!readonly" #actions>
        <UiButton size="sm" variant="danger" :loading="busy" @click="onRemove">
          Убрать из корзины
        </UiButton>
      </template>
    </UiAlert>

    <UiAlert v-if="changedItems.length" tone="warning" title="Цены изменились">
      <span class="changed-list">
        <span v-for="item in changedItems" :key="item.productId">
          {{ item.name }}: {{ formatPrice(item.clientPrice, item.currency) }} →
          <strong>{{ formatPrice(item.price, item.currency) }}</strong>
          ({{ direction(item.clientPrice, item.price) }})
        </span>
      </span>
      <template v-if="!readonly" #actions>
        <UiButton size="sm" variant="secondary" :loading="busy" @click="onAccept">
          Обновить цены
        </UiButton>
      </template>
    </UiAlert>

    <UiAlert v-if="backorderItems.length" tone="info" title="Под заказ">
      {{ backorderItems.map((i) => i.name || 'товар').join(', ') }} —
      сейчас нет на складе, срок поставки уточнит менеджер.
    </UiAlert>
  </div>
</template>

<style scoped>
.cart-issues {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.changed-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
