<script setup lang="ts">
import { useWishlistStore } from '~/stores/wishlist'
import { useCartStore } from '~/stores/cart'

const wishlist = useWishlistStore()
const cart = useCartStore()
const toast = useAppToast()
const { formatPrice } = useFormatPrice()

/** Favourites are a client-only list, so the cards are rendered from the store. */
function addToCart(productId: string) {
  const item = wishlist.items.find((i) => i.productId === productId)
  if (!item || item.price == null || item.price <= 0) return

  cart.add({
    productId: item.productId,
    slug: item.slug,
    name: item.name,
    sku: null,
    image: item.image,
    price: item.price,
    currency: item.currency,
  })
  toast.success(`«${item.name}» в корзине`)
}

function moveAllToCart() {
  const buyable = wishlist.items.filter((i) => i.price != null && i.price > 0)
  buyable.forEach((item) =>
    cart.add({
      productId: item.productId,
      slug: item.slug,
      name: item.name,
      sku: null,
      image: item.image,
      price: item.price as number,
      currency: item.currency,
    })
  )
  toast.success(`Добавлено в корзину: ${buyable.length}`)
}

useHead({
  title: 'Избранное | Мультитул',
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
})
</script>

<template>
  <div class="favorites-page">
    <UiBreadcrumbs :items="[{ label: 'Главная', to: '/' }, { label: 'Избранное' }]" />

    <header class="page-head">
      <div>
        <h1>Избранное</h1>
        <ClientOnly>
          <p v-if="!wishlist.isEmpty" class="subtitle">
            {{ wishlist.count }} товаров в списке
          </p>
        </ClientOnly>
      </div>
      <ClientOnly>
        <div v-if="!wishlist.isEmpty" class="head-actions">
          <UiButton variant="ghost" size="sm" @click="wishlist.clear()">Очистить</UiButton>
          <UiButton size="sm" @click="moveAllToCart">Всё в корзину</UiButton>
        </div>
      </ClientOnly>
    </header>

    <ClientOnly>
      <template #fallback>
        <div class="grid">
          <UiSkeleton v-for="i in 4" :key="i" height="280px" radius="var(--radius-md)" />
        </div>
      </template>

      <UiEmpty
        v-if="wishlist.isEmpty"
        icon="heart"
        title="В избранном пока пусто"
        description="Нажимайте на сердечко в карточке товара, чтобы сохранить его и вернуться позже."
      >
        <UiButton to="/catalog/">Перейти в каталог</UiButton>
      </UiEmpty>

      <ul v-else class="grid">
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
            <p v-if="item.price == null" class="on-request">
              {{ formatPrice(null, item.currency) }}
            </p>

            <div class="actions">
              <UiButton
                v-if="item.price != null && item.price > 0"
                size="sm"
                block
                @click="addToCart(item.productId)"
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
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
              </UiButton>
            </div>
          </div>
        </li>
      </ul>
    </ClientOnly>
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

.grid {
  display: grid;
  padding: 0;
  margin: 0;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-4);
  list-style: none;
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

.on-request {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.actions {
  display: flex;
  margin-top: auto;
  padding-top: var(--space-2);
  gap: var(--space-2);
}
</style>
