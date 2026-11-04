<script setup lang="ts">
// The AI screens are one page with tabs now; old links and bookmarks land on the tab.
definePageMeta({ layout: 'admin' })
const route = useRoute()
// «Промпты» used to be a sub-tab of the tasks; they live with the templates now.
await navigateTo({ path: '/admin/ai', query: { tab: route.query.tab === 'prompts' ? 'templates' : 'tasks' } }, { replace: true })
</script>

<template>
  <div />
</template>
