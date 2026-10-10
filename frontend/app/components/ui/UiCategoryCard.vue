<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

/**
 * One link to a category, in the three shapes the storefront needs.
 *
 * Before this component each surface drew its own: picture tiles on the home
 * page, rows with a chevron on the brand page, pills in the catalogue, each
 * with its own padding, radius, hover and count styling — so "a category" did
 * not look like one thing anywhere. The variants here differ in density only;
 * colour, radius, hover and the count treatment are shared.
 *
 * - `tile` — browsing: artwork, name, count. Home page, catalogue root.
 * - `row`  — dense list: thumb, name, count, chevron. Brand page.
 * - `chip` — a shortcut among many. Subcategories above a product grid.
 */
const props = withDefaults(defineProps<{
  name: string
  to: RouteLocationRaw
  /** Products in this category including its subtree; omit to hide. */
  count?: number | null
  image?: string | null
  variant?: 'tile' | 'row' | 'chip'
}>(), {
  count: null,
  image: null,
  variant: 'tile',
})

const countLabel = computed(() =>
  props.count === null || props.count === undefined
    ? ''
    : pluralize(props.count, 'product')
)

/**
 * Fallback artwork. Categories rarely have a picture — a letter plate is
 * calmer than a grey box and keeps every tile the same height.
 */
const initial = computed(() => props.name.trim().charAt(0).toUpperCase())
</script>

<template>
  <NuxtLink :to="to" class="category" :class="`is-${variant}`">
    <span v-if="variant !== 'chip'" class="media" aria-hidden="true">
      <img v-if="image" :src="image" alt="" loading="lazy">
      <span v-else class="plate">{{ initial }}</span>
    </span>

    <span class="body">
      <span class="name">{{ name }}</span>
      <span v-if="countLabel && variant !== 'chip'" class="count">{{ countLabel }}</span>
    </span>

    <span v-if="variant === 'chip' && count !== null" class="badge">{{ count }}</span>

    <svg v-if="variant === 'row'" class="chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </NuxtLink>
</template>

<style scoped>
.category {
  display: flex;
  border: 1px solid var(--border-subtle);
  background: var(--surface-card);
  color: var(--text-default);
  text-decoration: none;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.category:hover,
.category:focus-visible {
  border-color: var(--brand);
  box-shadow: var(--shadow-sm);
}

.category:hover .name,
.category:focus-visible .name {
  color: var(--brand);
}

.name {
  display: block;
  overflow: hidden;
  color: var(--text-strong);
  font-weight: 700;
  text-overflow: ellipsis;
}

.count {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.media {
  display: grid;
  overflow: hidden;
  background: var(--surface-sunken);
  place-items: center;
}

.media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: var(--image-blend);
}

.plate {
  color: var(--text-subtle);
  font-family: var(--font-heading);
  font-weight: 800;
  line-height: 1;
}

/* ---- tile ---- */
.is-tile {
  flex-direction: column;
  border-radius: var(--radius-md);
}

.is-tile .media {
  /* Supplier photos are shot on white, so the tile keeps them on the card
     surface with air around them rather than bleeding to the edges. */
  aspect-ratio: 4 / 3;
  padding: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-card);
}

.is-tile .media:has(.plate) {
  background: var(--surface-sunken);
}

.is-tile .plate {
  font-size: var(--text-3xl);
}

.is-tile .body {
  min-width: 0;
  padding: var(--space-3) var(--space-4) var(--space-4);
  font-size: var(--text-sm);
}

/* ---- row ---- */
.is-row {
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  gap: var(--space-3);
}

.is-row .media {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
}

.is-row .plate {
  font-size: var(--text-lg);
}

.is-row .body {
  min-width: 0;
  flex: 1;
}

.chevron {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--text-subtle);
}

.is-row:hover .chevron {
  color: var(--brand);
}

/* ---- chip ---- */
.is-chip {
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  gap: var(--space-2);
  white-space: nowrap;
}

.is-chip .name {
  font-weight: 600;
}

.badge {
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.is-chip:hover .badge {
  background: var(--brand-soft);
  color: var(--brand-soft-text);
}
</style>
