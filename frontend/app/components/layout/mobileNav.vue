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

// The counters need no <ClientOnly>: the stores load from localStorage in
// `onNuxtReady`, so they are empty during hydration exactly as on the server.

const items = computed(() => [
  {
    to: '/',
    label: 'Главная',
    icon: 'home' as const,
    active: route.path === '/',
  },
  {
    to: '/catalog',
    label: 'Каталог',
    icon: 'grid' as const,
    active: route.path.startsWith('/catalog'),
  },
  {
    to: '/favorites',
    label: 'Избранное',
    icon: 'heart' as const,
    active: route.path === '/favorites',
    count: wishlist.count,
  },
  {
    to: '/cart',
    label: 'Корзина',
    icon: 'cart' as const,
    active: route.path === '/cart',
    count: cart.count,
  },
  {
    // Always /account, never a session-dependent target: the session is
    // client-side, so branching here would differ between the server render
    // and hydration. /account sends a guest to the login screen itself.
    to: '/account',
    label: 'Кабинет',
    icon: 'user' as const,
    active: route.path === '/account',
  },
])
</script>

<template>
  <nav class="mobile-nav" aria-label="Мобильная навигация">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="item"
      :class="{ 'is-active': item.active }"
      :aria-current="item.active ? 'page' : undefined"
    >
      <span class="icon-wrap">
        <UiIcon :name="item.icon" :size="22" :stroke-width="1.7" />
        <span v-if="item.count" class="badge">{{ item.count }}</span>
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
  color: var(--text-inverse);
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
