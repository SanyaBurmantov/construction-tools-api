<script setup lang="ts">
const props = defineProps<{
  items: Array<{ label: string, to?: string }>
}>()

const { absoluteUrl } = useSite()

/** BreadcrumbList structured data — the crumbs are already on the page. */
const jsonLd = computed(() => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: props.items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.label,
    ...(item.to ? { item: absoluteUrl(item.to) } : {}),
  })),
}))

/**
 * Long and deep trails stay readable: every crumb is cut with «…» past a
 * width (the full name in `title` and in the JSON-LD), the trail wraps onto a
 * second line instead of scrolling sideways, and on a phone the middle levels
 * fold into one «…» that opens the whole trail.
 */
const expanded = ref(false)
const isMiddle = (index: number) => index > 0 && index < props.items.length - 2
// Folding one level saves nothing — «…» is as wide as «Каталог».
const hasMiddle = computed(() => props.items.length > 4)

useHead({
  script: [{ type: 'application/ld+json', innerHTML: () => JSON.stringify(jsonLd.value) }],
})
</script>

<template>
  <nav class="ui-breadcrumbs" :class="{ 'is-collapsed': hasMiddle && !expanded }" aria-label="Хлебные крошки">
    <ol>
      <template v-for="(item, index) in items" :key="index">
        <li v-if="index === 1 && hasMiddle && !expanded" class="more">
          <button type="button" aria-label="Показать весь путь" @click="expanded = true">…</button>
          <svg class="sep" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </li>
        <li :class="{ 'is-middle': isMiddle(index), 'is-current': index === items.length - 1 }">
          <NuxtLink v-if="item.to && index < items.length - 1" :to="item.to" class="label" :title="item.label">
            {{ item.label }}
          </NuxtLink>
          <span v-else class="label" aria-current="page" :title="item.label">{{ item.label }}</span>
          <svg v-if="index < items.length - 1" class="sep" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </li>
      </template>
    </ol>
  </nav>
</template>

<style scoped>
.ui-breadcrumbs {
  padding-bottom: var(--space-1);
}

ol {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding: 0;
  margin: 0;
  gap: 2px var(--space-1);
  list-style: none;
}

li {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.label {
  overflow: hidden;
  max-width: 240px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

a:hover {
  color: var(--text-link);
  text-decoration: underline;
}

.is-current .label {
  max-width: 420px;
  color: var(--text-strong);
  font-weight: 600;
}

.sep {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--text-subtle);
}

/* The «…» that opens a folded trail: phones only. */
.more {
  display: none;
}

.more button {
  padding: 0 var(--space-1);
  border: 0;
  border-radius: var(--radius-sm, 6px);
  background: var(--surface-sunken);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  line-height: 1.4;
}

@media (max-width: 640px) {
  .label {
    max-width: 44vw;
  }

  .is-current .label {
    max-width: calc(100vw - 2 * var(--space-4));
  }

  .is-collapsed .is-middle {
    display: none;
  }

  .is-collapsed .more {
    display: flex;
  }
}
</style>
