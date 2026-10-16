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
          <img v-if="item.image" :src="item.image" :alt="item.name" loading="lazy">
          <span v-else class="placeholder" aria-hidden="true" />
        </NuxtLink>

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
            <UiButton
              variant="ghost"
              size="sm"
              icon-only
              :aria-label="`Убрать ${item.name} из избранного`"
              @click="wishlist.remove(item.productId)"
            >
              <UiIcon name="close" :size="16" :stroke-width="1.8" />
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
  display: flex;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.image {
  display: block;
  aspect-ratio: 4 / 3;
  padding: var(--space-4);
}

.image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.placeholder {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
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
  overflow: hidden;
  color: var(--text-strong);
  font-weight: 700;
  line-height: var(--leading-snug);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
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
