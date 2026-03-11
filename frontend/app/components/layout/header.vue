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
    <div class="">
      Gost.By
    </div>
    <div class="">
    Беларусь, г. Витебск, пр-т Фрунзе, 39а, к.17
    </div>

    <div class="links">
      <div v-for="link of items">
        <NuxtLink :to="link.to">
          {{ link.label }}
        </NuxtLink>
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
header {
  display: flex;
  gap: 8px
}
.links {
  display: flex;
  gap: 8px
}
</style>