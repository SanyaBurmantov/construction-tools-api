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
  <header class="catalog-header">
    <div class="catalog-header__links">
      <div v-for="link of items">
        <NuxtLink :to="link.to">
          {{ link.label }}
        </NuxtLink>
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
.catalog-header {
  display: flex;
  justify-content: center;
  gap: 8px;

  &__links{
    display: flex;
    gap: 20px
  }
}
</style>