<script setup lang="ts">
const props = defineProps<{
  items: Array<{ label: string, to?: string }>
}>()

const config = useRuntimeConfig()
const siteUrl = computed(() => String(config.public.siteUrl).replace(/\/$/, ''))

/** BreadcrumbList structured data — the crumbs are already on the page. */
const jsonLd = computed(() => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: props.items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.label,
    ...(item.to ? { item: `${siteUrl.value}${item.to}` } : {}),
  })),
}))

useHead({
  script: [{ type: 'application/ld+json', innerHTML: () => JSON.stringify(jsonLd.value) }],
})
</script>

<template>
  <nav class="ui-breadcrumbs scroll-x" aria-label="Хлебные крошки">
    <ol>
      <li v-for="(item, index) in items" :key="index">
        <NuxtLink v-if="item.to && index < items.length - 1" :to="item.to">
          {{ item.label }}
        </NuxtLink>
        <span v-else aria-current="page">{{ item.label }}</span>
        <svg v-if="index < items.length - 1" class="sep" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M8 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.ui-breadcrumbs {
  padding-bottom: var(--space-1);
}

ol {
  display: flex;
  align-items: center;
  padding: 0;
  margin: 0;
  gap: var(--space-1);
  list-style: none;
}

li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-sm);
  white-space: nowrap;
}

a:hover {
  color: var(--text-link);
  text-decoration: underline;
}

li:last-child span {
  color: var(--text-strong);
  font-weight: 600;
}

.sep {
  width: 14px;
  height: 14px;
  color: var(--text-subtle);
}
</style>
