<script setup lang="ts">
import { useCartStore } from '~/stores/cart'

type Source = { id: string, name: string, code: string }

const route = useRoute()
const search = ref('')
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase
const cart = useCartStore()

const { data: sources } = await useAsyncData<Source[]>(
  'layout-sources',
  () => $fetch<Source[]>(`${apiBase}/sources`).catch(() => []),
  { default: () => [] }
)

const links = computed(() => [
  { label: 'Каталог', to: '/catalog/', active: route.path.startsWith('/catalog') },
  ...(sources.value || [])
    .filter(source => source.code)
    .map(source => ({
      label: source.name,
      to: `/catalog/?sourceCode=${source.code}`,
      active: route.query.sourceCode === source.code
    })),
  { label: 'Бренды', to: '/catalog/?focus=brands', active: route.query.focus === 'brands' }
])

function submitSearch() {
  const query = search.value.trim()
  navigateTo({ path: '/catalog/', query: query ? { search: query } : undefined })
}
</script>

<template>
  <header class="site-header">
    <div class="topbar">
      <span>Витебск</span>
      <a href="tel:+375298135797">+375 29 813-57-97</a>
      <a href="mailto:dm.krep@mail.ru">dm.krep@mail.ru</a>
    </div>

    <div class="header-shell">
      <NuxtLink to="/" class="brand" aria-label="Мультитул">
        <span class="brand-mark">М</span>
        <span>
          <strong>Мультитул</strong>
          <small>инструменты и крепеж</small>
        </span>
      </NuxtLink>

      <form class="header-search" @submit.prevent="submitSearch">
        <input v-model="search" type="search" placeholder="Искать инструмент, артикул, бренд">
        <button type="submit">Найти</button>
      </form>

      <NuxtLink class="cart-button" to="/cart/" aria-label="Корзина">
        <span class="cart-icon" aria-hidden="true">🛒</span>
        <span class="cart-label">Корзина</span>
        <ClientOnly>
          <span v-if="cart.count" class="cart-badge">{{ cart.count }}</span>
        </ClientOnly>
      </NuxtLink>
    </div>

    <nav class="nav-row" aria-label="Основная навигация">
      <NuxtLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="nav-link"
        :class="{ active: link.active }"
      >
        {{ link.label }}
      </NuxtLink>
    </nav>
  </header>
</template>

<style scoped lang="scss">
.site-header {
  position: sticky;
  top: 0;
  z-index: 30;
  border-bottom: 1px solid var(--color-line);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(16px);
}

.topbar {
  display: none;
  width: min(1280px, calc(100% - 32px));
  min-height: 34px;
  align-items: center;
  gap: 18px;
  margin: 0 auto;
  color: var(--color-muted);
  font-size: 13px;

  a {
    text-decoration: none;
  }

  @include media-breakpoint-up(md) {
    display: flex;
  }
}

.header-shell {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  width: min(1280px, calc(100% - 32px));
  min-height: 68px;
  align-items: center;
  margin: 0 auto;

  @include media-breakpoint-up(md) {
    grid-template-columns: 260px minmax(0, 1fr) auto;
  }
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;

  strong,
  small {
    display: block;
  }

  strong {
    color: #101828;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: -0.04em;
  }

  small {
    color: var(--color-muted);
    font-size: 12px;
  }
}

.brand-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 12px;
  background: var(--color-primary);
  color: white;
  font-weight: 900;
}

.header-search {
  display: none;
  overflow: hidden;
  height: 44px;
  border: 2px solid var(--color-primary);
  border-radius: 12px;
  background: white;

  @include media-breakpoint-up(md) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 96px;
  }

  input {
    min-width: 0;
    border: 0;
    outline: 0;
    padding: 0 14px;
  }

  button {
    background: var(--color-primary);
    color: white;
    cursor: pointer;
    font-weight: 800;
  }
}

.cart-button {
  position: relative;
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  border-radius: 12px;
  background: #ffcf26;
  color: #101828;
  font-weight: 900;
  padding: 0 16px;
  text-decoration: none;
}

.cart-icon {
  font-size: 18px;
}

.cart-label {
  display: none;

  @include media-breakpoint-up(md) {
    display: inline;
  }
}

.cart-badge {
  position: absolute;
  top: -8px;
  right: -8px;
  display: inline-flex;
  min-width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--color-primary);
  color: white;
  font-size: 12px;
  font-weight: 900;
  padding: 0 6px;
}

.nav-row {
  display: flex;
  gap: 4px;
  width: min(1280px, calc(100% - 32px));
  margin: 0 auto;
  overflow-x: auto;
  padding: 0 0 10px;
}

.nav-link {
  flex: 0 0 auto;
  border-radius: 999px;
  color: var(--color-muted);
  font-weight: 700;
  padding: 8px 12px;
  text-decoration: none;

  &.active,
  &:hover {
    background: #eef4ff;
    color: var(--color-primary);
  }
}

@media (max-width: 520px) {
  .brand small {
    display: none;
  }
}
</style>
