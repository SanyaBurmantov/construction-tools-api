<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
const route = useRoute()

const items = computed<NavigationMenuItem[]>(() => [
  {
    label: 'Главная',
    to: '/',
    active: route.path === '/'
  },
  {
    label: 'Каталог',
    to: '/catalog/',
    active: route.path.startsWith('/catalog')
  },
  {
    label: 'Поиск',
    to: '/search/',
    active: route.path.startsWith('/search')
  },
  {
    label: 'Бренды',
    to: '/brand/',
    active: route.path.startsWith('/brand')
  },
  {
    label: 'Акции',
    to: '/sales/',
    active: route.path.startsWith('/sales')
  },
  {
    label: 'Оплата и доставка',
    to: '/delivery/',
    active: route.path.startsWith('/delivery')
  },
  {
    label: 'Контакты',
    to: '/contacts/',
    active: route.path.startsWith('/contacts')
  },
  {
    label: 'Вход',
    to: '/auth/',
    active: route.path.startsWith('/auth')
  }
])
</script>

<template>
  <header class="header">
    <div class="top-bar">
      <div class="container">
        <div class="row">
          <div class="col-left">
            <p class="location">
              <span class="fa fa-map-marker" />
              Беларусь, г. Витебск, пр-т Фрунзе, 39а, к.17
            </p>
          </div>

          <div class="col-right">
            <div class="basket">
              <a href="/order/">
                <span id="basket-status">
                  <i class="fa fa-shopping-basket" /> В корзине нет товаров
                </span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <UHeader class="main-header" mode="slideover">
      <template #title>
        <ULink to="/" class="navbar-brand">Gost.By</ULink>
      </template>

      <UNavigationMenu
          :items="items"
          class="desktop-menu"
      />

      <template #body>
        <UNavigationMenu
            :items="items"
            orientation="vertical"
            class="mobile-menu -mx-2.5"
        />
      </template>
    </UHeader>
  </header>
</template>

<style scoped>

/* ---------------- Верхняя панель ---------------- */

.top-bar {
  background: var(--color-bg-light);
  padding: 12px 0;
  font-size: 14px;
  color: var(--color-text);
}

.container {
  margin: 0 auto;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0 20px;
  gap: 40px;
}

/* ---------------- Основной хедер ---------------- */

.main-header {
  background: var(--color-primary) !important;
  color: var(--color-text-light);
}

.navbar-brand {
  font-size: 22px;
  text-decoration: none;
  color: var(--color-text);
}

.desktop-menu a,
.mobile-menu a {
  color: var(--color-text-light);
  text-decoration: none;
  transition: color 0.2s ease, background 0.2s ease;
}

.desktop-menu {
  display: flex;
  gap: 1rem;
}

.mobile-menu {
  display: none;
  background: var(--color-primary);
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
}

/* ---------------- Адаптив ---------------- */

@media (max-width: 768px) {
  .desktop-menu {
    display: none !important;
  }

  .mobile-menu {
    display: block !important;
  }
}
</style>