<script setup lang="ts">
import { useCartStore } from '~/stores/cart'
import { useWishlistStore } from '~/stores/wishlist'

const cart = useCartStore()
const wishlist = useWishlistStore()
const toast = useAppToast()
const { formatPrice } = useFormatPrice()
const cartValidation = useCartValidation()
const { ensureAuthenticated } = useCheckoutAuth()
const { isAuthenticated } = useAuth()

const goingToCheckout = ref(false)

/**
 * Checkout requires an account. The cart is in localStorage, so the detour to
 * the login screen keeps every line — `redirect` brings them back here.
 */
async function goToCheckout() {
  goingToCheckout.value = true
  try {
    if (await ensureAuthenticated('/checkout')) await navigateTo('/checkout')
  } finally {
    goingToCheckout.value = false
  }
}

onMounted(async () => {
  cart.load()
  wishlist.load()
  // Re-price against the API before the customer looks at the total.
  await cartValidation.validate()
})

function moveToWishlist(productId: string) {
  const item = cart.items.find((i) => i.productId === productId)
  if (!item) return
  wishlist.add({
    productId: item.productId,
    slug: item.slug,
    name: item.name,
    image: item.image,
    price: item.price,
    oldPrice: null,
    currency: item.currency,
  })
  cart.remove(productId)
  toast.info('Перенесено в избранное')
}

useHead({
  title: 'Корзина | Gost.by',
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
})
</script>

<template>
  <div class="cart-page">
    <UiBreadcrumbs :items="[{ label: 'Главная', to: '/' }, { label: 'Корзина' }]" />

    <h1>Корзина</h1>

    <ClientOnly>
      <template #fallback>
        <UiSkeleton height="300px" radius="var(--radius-md)" />
      </template>

      <UiEmpty
        v-if="cart.isEmpty"
        icon="cart"
        title="Корзина пуста"
        description="Добавьте товары из каталога — сохранённое здесь не пропадёт при перезагрузке."
      >
        <UiButton to="/catalog">Перейти в каталог</UiButton>
        <UiButton variant="secondary" to="/favorites">Открыть избранное</UiButton>
      </UiEmpty>

      <div v-else class="layout">
        <CartIssues class="issues" />

        <section class="items">
          <header class="items-head">
            <span>{{ pluralize(cart.distinctCount, 'position') }} · {{ cart.count }} шт.</span>
            <UiButton variant="ghost" size="sm" @click="cart.clear()">Очистить корзину</UiButton>
          </header>

          <ul class="item-list">
            <li v-for="item in cart.items" :key="item.productId" class="item">
              <NuxtLink :to="`/product/${item.slug}`" class="item-image">
                <img v-if="item.image" :src="item.image" :alt="item.name" loading="lazy">
                <span v-else class="image-empty" aria-hidden="true" />
              </NuxtLink>

              <div class="item-body">
                <NuxtLink :to="`/product/${item.slug}`" class="item-name">{{ item.name }}</NuxtLink>
                <span v-if="item.sku" class="item-sku">Арт. {{ item.sku }}</span>
                <span class="item-unit">{{ formatPrice(item.price, item.currency) }} / шт.</span>
              </div>

              <UiQuantity
                :model-value="item.quantity"
                size="sm"
                @update:model-value="cart.setQuantity(item.productId, $event)"
              />

              <strong class="item-total">
                {{ formatPrice(item.price * item.quantity, item.currency) }}
              </strong>

              <div class="item-actions">
                <button type="button" @click="moveToWishlist(item.productId)">В избранное</button>
                <button type="button" class="is-danger" @click="cart.remove(item.productId)">
                  Удалить
                </button>
              </div>
            </li>
          </ul>
        </section>

        <CartOrderSummary title="Итого" total-label="К оплате">
          <p class="note">Стоимость доставки рассчитывается на следующем шаге.</p>

          <UiButton size="lg" block :loading="goingToCheckout" @click="goToCheckout">
            Оформить заказ
          </UiButton>
          <p class="note auth-note">
            <template v-if="isAuthenticated">
              Корзина сохранена в аккаунте — она откроется и на другом устройстве.
            </template>
            <template v-else>
              Для оформления заказа понадобится вход — товары в корзине сохранятся.
            </template>
          </p>
          <UiButton variant="ghost" block to="/catalog">Продолжить покупки</UiButton>
        </CartOrderSummary>
      </div>
    </ClientOnly>
  </div>
</template>

<style scoped>
.cart-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.auth-note {
  text-align: center;
}

.layout {
  display: grid;
  align-items: start;
  gap: var(--space-6);
  grid-template-columns: minmax(0, 1fr) 360px;
}

/* Warnings span both columns, above the items and the summary. */
.issues {
  grid-column: 1 / -1;
}

/* ---- Items ---- */
.items {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.items-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.item-list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}

.item {
  display: grid;
  align-items: center;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  gap: var(--space-4);
  grid-template-columns: 72px minmax(0, 1fr) auto auto;
  grid-template-areas:
    'image body qty total'
    'image actions actions actions';
}

.item:last-child {
  border-bottom: 0;
}

.item-image {
  display: block;
  width: 72px;
  height: 72px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  grid-area: image;
}

.item-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-empty {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.item-body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  grid-area: body;
}

.item-name {
  color: var(--text-strong);
  font-weight: 600;
}

.item-name:hover {
  color: var(--text-link);
}

.item-sku,
.item-unit {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.item :deep(.ui-quantity) {
  grid-area: qty;
}

.item-total {
  color: var(--text-strong);
  font-size: var(--text-md);
  font-variant-numeric: tabular-nums;
  grid-area: total;
  white-space: nowrap;
}

.item-actions {
  display: flex;
  gap: var(--space-4);
  grid-area: actions;
}

.item-actions button {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.item-actions button:hover {
  color: var(--text-link);
}

.item-actions .is-danger:hover {
  color: var(--danger);
}

.note {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

@media (max-width: 1000px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .item {
    grid-template-columns: 60px minmax(0, 1fr);
    grid-template-areas:
      'image body'
      'image qty'
      'total total'
      'actions actions';
  }

  .item-image {
    width: 60px;
    height: 60px;
  }

  .item-total {
    text-align: right;
  }
}
</style>
