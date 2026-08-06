<script setup lang="ts">
import { useCartStore } from '~/stores/cart'
import { useWishlistStore } from '~/stores/wishlist'

/**
 * Bottom navigation for phones — the pattern every large marketplace uses,
 * because the header scrolls away and thumbs reach the bottom of the screen.
 * Hidden on desktop, where the header already carries these actions.
 */
const cart = useCartStore()
const wishlist = useWishlistStore()
const route = useRoute()

const items = computed(() => [
  {
    to: '/',
    label: 'Главная',
    icon: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
    active: route.path === '/',
  },
  {
    to: '/catalog/',
    label: 'Каталог',
    icon: 'M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z',
    active: route.path.startsWith('/catalog'),
  },
  {
    to: '/favorites',
    label: 'Избранное',
    icon: 'M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5C19 15.5 12 20 12 20z',
    active: route.path === '/favorites',
    count: wishlist.count,
  },
  {
    to: '/cart',
    label: 'Корзина',
    icon: 'M3 4h2l2.4 10.4A2 2 0 0 0 9.35 16H17a2 2 0 0 0 1.95-1.55L20.5 8H6',
    active: route.path === '/cart',
    count: cart.count,
  },
])
</script>

<template>
  <nav class="mobile-nav" aria-label="Основная навигация">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="item"
      :class="{ 'is-active': item.active }"
      :aria-current="item.active ? 'page' : undefined"
    >
      <span class="icon-wrap">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path :d="item.icon" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <ClientOnly>
          <span v-if="item.count" class="badge">{{ item.count }}</span>
        </ClientOnly>
      </span>
      <span class="label">{{ item.label }}</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.mobile-nav {
  position: fixed;
  z-index: var(--z-sticky);
  right: 0;
  bottom: 0;
  left: 0;
  display: none;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-card);
  box-shadow: 0 -2px 12px rgb(16 24 40 / 8%);
  padding-bottom: env(safe-area-inset-bottom);
}

.item {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  padding: var(--space-2) 0;
  color: var(--text-muted);
  gap: 2px;
}

.item.is-active {
  color: var(--brand);
}

.icon-wrap {
  position: relative;
  display: block;
}

.icon-wrap svg {
  width: 22px;
  height: 22px;
}

.badge {
  position: absolute;
  top: -4px;
  right: -8px;
  display: grid;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--radius-full);
  background: var(--sale);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  place-items: center;
}

.label {
  font-size: 10px;
  font-weight: 600;
}

@media (max-width: 860px) {
  .mobile-nav {
    display: flex;
  }
}
</style>
