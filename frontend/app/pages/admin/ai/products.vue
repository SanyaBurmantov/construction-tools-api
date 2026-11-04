<script setup lang="ts">
// The AI screens are one page with tabs now; old links and bookmarks land on the tab.
definePageMeta({ layout: 'admin' })
await navigateTo({ path: '/admin/ai', query: {} }, { replace: true })
</script>

<template>
  <div />
</template>
