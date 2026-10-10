<script setup lang="ts">
import { useCartStore } from '~/stores/cart'
import { useWishlistStore } from '~/stores/wishlist'

const cart = useCartStore()
const wishlist = useWishlistStore()
const toast = useAppToast()
const { formatPrice } = useFormatPrice()
const promo = usePromoCode()
const cartValidation = useCartValidation()

const promoInput = ref('')

onMounted(async () => {
  cart.load()
  wishlist.load()
  // Re-price against the API before the customer looks at the total.
  await cartValidation.validate()
  await promo.restore()
  promoInput.value = promo.code.value
})

// A changed subtotal can invalidate a min-order code, so re-check on edits.
watch(
  () => cart.totalPrice,
  async () => {
    if (promo.preview.value) await promo.validate(promo.code.value)
  }
)

async function applyPromo() {
  const ok = await promo.validate(promoInput.value)
  if (ok) toast.success(`Промокод ${promo.code.value} применён`)
}

function removePromo() {
  promo.clear()
  promoInput.value = ''
}

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

const total = computed(() =>
  Math.max(0, Math.round((cart.totalPrice - promo.discount.value) * 100) / 100)
)

useHead({
  title: 'Корзина | Мультитул',
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
        <UiButton to="/catalog/">Перейти в каталог</UiButton>
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

        <aside class="summary">
          <div class="summary-card">
            <h2>Итого</h2>

            <div class="promo">
              <UiField label="Промокод" :error="promo.error.value">
                <div v-if="!promo.preview.value" class="promo-input">
                  <UiInput
                    v-model="promoInput"
                    placeholder="Введите код"
                    :invalid="Boolean(promo.error.value)"
                    @keydown.enter.prevent="applyPromo"
                  />
                  <UiButton
                    variant="secondary"
                    :loading="promo.validating.value"
                    @click="applyPromo"
                  >
                    Применить
                  </UiButton>
                </div>
                <div v-else class="promo-applied">
                  <div>
                    <code>{{ promo.preview.value.code }}</code>
                    <span v-if="promo.preview.value.freeDelivery">+ бесплатная доставка</span>
                  </div>
                  <button type="button" aria-label="Убрать промокод" @click="removePromo">✕</button>
                </div>
              </UiField>
            </div>

            <dl class="totals">
              <div>
                <dt>Товары ({{ cart.count }})</dt>
                <dd>{{ formatPrice(cart.totalPrice, cart.currency) }}</dd>
              </div>
              <div v-if="promo.discount.value" class="is-discount">
                <dt>Скидка</dt>
                <dd>−{{ formatPrice(promo.discount.value, cart.currency) }}</dd>
              </div>
              <div class="is-total">
                <dt>К оплате</dt>
                <dd>{{ formatPrice(total, cart.currency) }}</dd>
              </div>
            </dl>

            <p class="note">Стоимость доставки рассчитывается на следующем шаге.</p>

            <UiButton size="lg" block to="/checkout">Оформить заказ</UiButton>
            <UiButton variant="ghost" block to="/catalog/">Продолжить покупки</UiButton>
          </div>
        </aside>
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

/* ---- Summary ---- */
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
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.totals dd {
  margin: 0;
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
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

.note {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

@media (max-width: 1000px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .summary {
    position: static;
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
