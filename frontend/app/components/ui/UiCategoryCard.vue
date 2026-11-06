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
 * - `tile`    — browsing, a shop window: the photo on a soft plate in one
 *               scale, the count as a label on it, a lift on hover. Home page,
 *               catalogue root.
 * - `compact` — subcategories above a category's products: a 64px photo, name,
 *               count, chevron — eight of them take two short rows.
 * - `row`     — dense list: thumb, name, count, chevron. Brand page.
 * - `chip`    — a shortcut among many: the strip once a filter is applied.
 */
const props = withDefaults(defineProps<{
  name: string
  to: RouteLocationRaw
  /** Products in this category including its subtree; omit to hide. */
  count?: number | null
  image?: string | null
  variant?: 'tile' | 'compact' | 'row' | 'chip'
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

/**
 * Intrinsic size for the `<img>`: the box is sized by CSS (square tile plate,
 * 64px compact, 44px row thumb), but without attributes the browser cannot
 * reserve it before the stylesheet and the image arrive (layout shift).
 */
const imageSize = computed(() =>
  props.variant === 'row'
    ? { width: 44, height: 44 }
    : props.variant === 'compact'
      ? { width: 64, height: 64 }
      : { width: 240, height: 240 }
)
</script>

<template>
  <NuxtLink :to="to" class="category" :class="`is-${variant}`">
    <span v-if="variant !== 'chip'" class="media" aria-hidden="true">
      <!-- Resized through IPX: supplier originals are 1200x900 for a box this
           size (see ProductThumb for the fallback chain). -->
      <ProductThumb
        v-if="image"
        :src="image"
        :alt="name"
        :width="imageSize.width"
        :height="imageSize.height"
      />
      <span v-else class="plate">{{ initial }}</span>
    </span>

    <!-- On a tile the count is a label on the photo. -->
    <span v-if="variant === 'tile' && count !== null" class="tag" :title="countLabel">{{ count.toLocaleString('ru-RU') }}</span>

    <span class="body">
      <span class="name">{{ name }}</span>
      <span v-if="countLabel && (variant === 'row' || variant === 'compact')" class="count">{{ countLabel }}</span>
    </span>

    <span v-if="variant === 'chip' && count !== null" class="badge">{{ count }}</span>

    <svg v-if="variant === 'row' || variant === 'compact'" class="chevron" viewBox="0 0 24 24" aria-hidden="true">
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
/* Variant selectors carry `.category`: a bare `.is-compact:hover` also
   matched the catalogue's `.category-grid.is-compact`, and hovering the
   grid zoomed every picture in it (2026-11-06). */
/* A soft plate for photos: shot on white, they melt into it (multiply) and
   read as one series whatever their own background. */
.category {
  --plate: color-mix(in srgb, var(--surface-sunken) 72%, var(--brand-soft));

  position: relative;
  display: flex;
  border: 1px solid var(--border-subtle);
  background: var(--surface-card);
  color: var(--text-default);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.category:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow-sm);
}

.category:focus-visible {
  border-color: var(--brand);
  outline: 3px solid color-mix(in srgb, var(--brand) 30%, transparent);
  outline-offset: 2px;
}

.category:hover .name,
.category:focus-visible .name {
  color: var(--brand);
}

/* A press you can feel: the card settles under the finger. */
.category:active {
  transform: scale(0.98);
  transition-duration: 60ms;
}

.name {
  display: block;
  overflow: hidden;
  color: var(--text-strong);
  font-weight: 700;
  text-overflow: ellipsis;
  transition: color var(--duration-fast) var(--ease-out);
}

.count {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.media {
  display: grid;
  overflow: hidden;
  background: var(--plate);
  place-items: center;
}

.media :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: var(--image-blend);
  transition: transform var(--duration-slow) var(--ease-out);
}

.plate {
  color: color-mix(in srgb, var(--brand) 35%, var(--text-subtle));
  font-family: var(--font-heading);
  font-weight: 800;
  line-height: 1;
}

.chevron {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--text-subtle);
  transition:
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.category:hover .chevron {
  color: var(--brand);
  transform: translateX(3px);
}

/* ---- tile: the shop window ---- */
.category.is-tile {
  flex-direction: column;
  padding: var(--space-2);
  border-color: transparent;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  gap: var(--space-2);
}

.category.is-tile:hover {
  border-color: transparent;
  box-shadow: var(--shadow-md), 0 12px 24px -10px rgb(16 24 40 / 18%);
  transform: translateY(-3px);
}

.category.is-tile:active {
  transform: translateY(-1px) scale(0.98);
}

.category.is-tile .media {
  aspect-ratio: 4 / 3;
  border-radius: var(--radius-md);
}

.category.is-tile .media :deep(img) {
  width: 78%;
  height: 78%;
}

.category.is-tile:hover .media :deep(img) {
  transform: scale(1.06);
}

.category.is-tile .plate {
  font-size: var(--text-3xl);
}

.tag {
  position: absolute;
  top: calc(var(--space-2) + 8px);
  left: calc(var(--space-2) + 8px);
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--surface-card) 88%, transparent);
  box-shadow: 0 1px 2px rgb(16 24 40 / 8%);
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 18px;
}

.category.is-tile .body {
  min-width: 0;
  padding: 0 var(--space-2) var(--space-2);
}

.category.is-tile .name {
  display: -webkit-box;
  min-height: calc(2em * var(--leading-snug));
  -webkit-box-orient: vertical;
  font-size: var(--text-sm);
  -webkit-line-clamp: 2;
  line-height: var(--leading-snug);
  overflow-wrap: break-word;
  text-overflow: clip;
}

/* Phones: three tiles to a row (~105px each). */
@media (max-width: 560px) {
  .category.is-tile {
    padding: 6px;
    gap: 6px;
  }

  .category.is-tile .plate {
    font-size: var(--text-2xl);
  }

  .category.is-tile .body {
    padding: 0 2px 4px;
  }

  .category.is-tile .name {
    font-size: var(--text-xs);
    hyphens: auto;
  }

  .tag {
    top: 10px;
    left: 10px;
    padding: 0 6px;
    font-size: 10px;
    line-height: 16px;
  }
}

@media (hover: none) {
  /* No lift on touch: it stuck after a tap. The press stays. */
  .category.is-tile:hover {
    box-shadow: var(--shadow-sm);
    transform: none;
  }

  .category.is-tile:hover .media :deep(img) {
    transform: none;
  }
}

/* ---- compact: subcategories above the products ---- */
.category.is-compact {
  min-width: 0;
  align-items: center;
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
  border-radius: var(--radius-md);
  gap: var(--space-3);
}

.category.is-compact:hover {
  border-color: color-mix(in srgb, var(--brand) 45%, var(--border-subtle));
  box-shadow: var(--shadow-md);
}

.category.is-compact .media {
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 10px;
}

.category.is-compact .media :deep(img) {
  width: 84%;
  height: 84%;
}

.category.is-compact:hover .media :deep(img) {
  transform: scale(1.08);
}

.category.is-compact .plate {
  font-size: var(--text-xl, 22px);
}

.category.is-compact .body {
  min-width: 0;
  flex: 1;
}

.category.is-compact .name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  font-size: var(--text-sm);
  -webkit-line-clamp: 2;
  line-height: var(--leading-snug);
  text-overflow: clip;
}

@media (max-width: 560px) {
  .category.is-compact {
    padding: 6px var(--space-2) 6px 6px;
    gap: var(--space-2);
  }

  .category.is-compact .media {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
  }

  /* «Аккумуляторная» has to fit a ~115px column: a size it fits at, real
     hyphenation where the browser has it, a break only as the last resort. */
  .category.is-compact .name {
    font-size: 12.5px;
    hyphens: auto;
    overflow-wrap: break-word;
  }

  .category.is-compact .chevron {
    display: none;
  }
}

/* ---- row ---- */
.category.is-row {
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  gap: var(--space-3);
}

.category.is-row .media {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
}

.category.is-row .plate {
  font-size: var(--text-lg);
}

.category.is-row .body {
  min-width: 0;
  flex: 1;
}

/* ---- chip ---- */
.category.is-chip {
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  gap: var(--space-2);
  white-space: nowrap;
}

.category.is-chip .name {
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

.category.is-chip:hover .badge {
  background: var(--brand-soft);
  color: var(--brand-soft-text);
}

@media (prefers-reduced-motion: reduce) {
  .category,
  .media :deep(img),
  .chevron {
    transition: none;
  }

  .category:hover,
  .category:active,
  .category.is-tile:hover .media :deep(img),
  .category.is-compact:hover .media :deep(img),
  .category:hover .chevron {
    transform: none;
  }
}
</style>
