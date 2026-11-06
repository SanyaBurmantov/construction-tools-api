<script setup lang="ts">
import { useWishlistStore, type WishlistItem } from '~/stores/wishlist'
import { useCartStore } from '~/stores/cart'

const wishlist = useWishlistStore()
const cart = useCartStore()
const toast = useAppToast()

const canBuy = (item: WishlistItem) => item.price != null && item.price > 0

/** Favourites are a client-only list, so the cart line is built from the store entry. */
function toCartLine(item: WishlistItem) {
  return {
    productId: item.productId,
    slug: item.slug,
    name: item.name,
    sku: null,
    image: item.image,
    price: item.price as number,
    currency: item.currency,
  }
}

function addToCart(item: WishlistItem) {
  if (!canBuy(item)) return
  cart.add(toCartLine(item))
  toast.success(`«${item.name}» в корзине`)
}

function moveAllToCart() {
  const buyable = wishlist.items.filter(canBuy)
  buyable.forEach(item => cart.add(toCartLine(item)))
  toast.success(`Добавлено в корзину: ${buyable.length}`)
}

useHead({
  title: 'Избранное | Gost.by',
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
})
</script>

<template>
  <div class="favorites-page">
    <UiBreadcrumbs :items="[{ label: 'Главная', to: '/' }, { label: 'Избранное' }]" />

    <header class="page-head">
      <div>
        <h1>Избранное</h1>
        <p v-if="!wishlist.isEmpty" class="subtitle">
          {{ pluralize(wishlist.count, 'product') }} в списке
        </p>
      </div>
      <div v-if="!wishlist.isEmpty" class="head-actions">
        <UiButton variant="ghost" size="sm" @click="wishlist.clear()">Очистить</UiButton>
        <UiButton size="sm" @click="moveAllToCart">Всё в корзину</UiButton>
      </div>
    </header>

    <UiEmpty
      v-if="wishlist.isEmpty"
      icon="heart"
      title="В избранном пока пусто"
      description="Нажимайте на сердечко в карточке товара, чтобы сохранить его и вернуться позже."
    >
      <UiButton to="/catalog">Перейти в каталог</UiButton>
    </UiEmpty>

    <ul v-else class="product-grid">
      <li v-for="item in wishlist.items" :key="item.productId" class="fav-card">
        <NuxtLink :to="`/product/${item.slug}`" class="image">
          <ProductThumb :src="item.image" :alt="item.name" :width="240" :height="180" />
        </NuxtLink>
        <button
          type="button"
          class="remove"
          :aria-label="`Убрать ${item.name} из избранного`"
          title="Убрать из избранного"
          @click="wishlist.remove(item.productId)"
        >
          <UiIcon name="trash" :size="16" :stroke-width="1.8" />
        </button>

        <div class="body">
          <NuxtLink :to="`/product/${item.slug}`" class="name">{{ item.name }}</NuxtLink>
          <UiPrice
            :value="item.price"
            :old-price="item.oldPrice"
            :currency="item.currency"
            size="sm"
          />

          <div class="actions">
            <UiButton
              v-if="canBuy(item)"
              size="sm"
              block
              @click="addToCart(item)"
            >
              В корзину
            </UiButton>
            <UiButton v-else size="sm" variant="secondary" block :to="`/product/${item.slug}`">
              Подробнее
            </UiButton>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.favorites-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
}

.subtitle {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.head-actions {
  display: flex;
  gap: var(--space-2);
}

.fav-card {
  position: relative;
  display: flex;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  transition:
    box-shadow var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.fav-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.image {
  display: grid;
  aspect-ratio: 4 / 3;
  padding: var(--space-4);
  place-items: center;
}

.image :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* Always visible, the same control as in the comparison. */
.remove {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  display: grid;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--surface-card);
  box-shadow: var(--shadow-xs);
  color: var(--text-muted);
  place-items: center;
  transition:
    color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.remove:hover,
.remove:focus-visible {
  border-color: var(--danger);
  background: var(--danger-soft);
  color: var(--danger);
}

.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-2);
}

.name {
  display: -webkit-box;
  /* Three lines held even for a short name, so prices and buttons line up. */
  min-height: calc(3 * 1.4em);
  overflow: hidden;
  color: var(--text-strong);
  font-weight: 700;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.name:hover {
  color: var(--text-link);
}

.actions {
  display: flex;
  margin-top: auto;
  padding-top: var(--space-2);
  gap: var(--space-2);
}
</style>
