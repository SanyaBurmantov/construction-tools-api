<script setup lang="ts">
// Поиск живёт в каталоге; страница оставлена для старых ссылок.
const route = useRoute()
const query = Array.isArray(route.query.q) ? route.query.q[0] : route.query.q

await navigateTo(
  { path: '/catalog/', query: query ? { search: String(query) } : undefined },
  { redirectCode: 301, replace: true }
)
</script>

<template>
  <div />
</template>
