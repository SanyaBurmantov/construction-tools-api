<script setup lang="ts">
import type { BreadcrumbItem } from '~/types/api'
import type { CategoryChild } from '~/composables/useCategoryChildren'

const props = defineProps<{
  items: BreadcrumbItem[]
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

/*
 * A category crumb opens its subcategories on hover (or keyboard focus):
 * the trail doubles as a way sideways through the catalogue. Fetched on the
 * first hover and cached (useCategoryChildren); a category with none opens
 * nothing. Hover devices only — on a phone a tap is a tap.
 */
const { load } = useCategoryChildren()
const children = reactive<Record<string, CategoryChild[]>>({})
const openIndex = ref<number | null>(null)
const alignEnd = ref(false)
let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined

const canHover = () => import.meta.client && window.matchMedia('(hover: hover)').matches
const menuOf = (item: BreadcrumbItem) => (item.category === undefined ? [] : children[item.category] ?? [])

function open(index: number, event: Event, immediate = false) {
  const item = props.items[index]
  if (item?.category === undefined) return
  clearTimeout(closeTimer)
  clearTimeout(openTimer)
  const li = event.currentTarget as HTMLElement
  const show = async () => {
    const slug = item.category!
    if (!children[slug]) children[slug] = await load(slug)
    alignEnd.value = li.getBoundingClientRect().left > window.innerWidth - 340
    openIndex.value = index
  }
  if (immediate) void show()
  else openTimer = setTimeout(show, 120)
}

function onEnter(index: number, event: MouseEvent) {
  if (canHover()) open(index, event)
}

function keepOpen() {
  clearTimeout(closeTimer)
}

function onLeave() {
  clearTimeout(openTimer)
  closeTimer = setTimeout(() => (openIndex.value = null), 200)
}

function onFocusOut(event: FocusEvent) {
  const li = event.currentTarget as HTMLElement
  if (!li.contains(event.relatedTarget as Node | null)) onLeave()
}

function close() {
  clearTimeout(openTimer)
  openIndex.value = null
}

const route = useRoute()
watch(() => route.fullPath, close)
onBeforeUnmount(() => {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
})

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
        <li
          :class="{
            'is-middle': isMiddle(index),
            'is-current': index === items.length - 1,
            'has-menu': item.category !== undefined,
            'is-open': openIndex === index && menuOf(item).length > 0,
          }"
          @mouseenter="onEnter(index, $event)"
          @mouseleave="onLeave"
          @focusin="canHover() && open(index, $event, true)"
          @focusout="onFocusOut"
          @keydown.esc="close"
        >
          <NuxtLink v-if="item.to && index < items.length - 1" :to="item.to" class="label" :title="item.label">
            {{ item.label }}
          </NuxtLink>
          <span v-else class="label" aria-current="page" :title="item.label">{{ item.label }}</span>
          <svg v-if="index < items.length - 1" class="sep" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>

          <div
            v-if="openIndex === index && menuOf(item).length"
            class="menu"
            :class="{ 'align-end': alignEnd }"
            @mouseenter="keepOpen"
          >
            <p class="menu-title">{{ item.category ? 'Подкатегории' : 'Разделы каталога' }}</p>
            <ul>
              <li v-for="child in menuOf(item)" :key="child.slug">
                <NuxtLink :to="`/catalog/${child.slug}`" @click="close">
                  <span class="menu-name">{{ child.name }}</span>
                  <span class="menu-count">{{ child.productCount }}</span>
                </NuxtLink>
              </li>
            </ul>
          </div>
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
  position: relative;
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

/* Subcategories on hover. */
.menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: -8px;
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: 220px;
  max-width: min(340px, calc(100vw - 32px));
  padding: var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
}

/* The hover bridge: the pointer crosses the 4px gap without closing it. */
.menu::before {
  position: absolute;
  top: -6px;
  right: 0;
  left: 0;
  height: 6px;
  content: '';
}

.menu.align-end {
  right: -8px;
  left: auto;
}

.menu-title {
  padding: var(--space-1) var(--space-2);
  margin: 0;
  color: var(--text-subtle);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.menu ul {
  max-height: min(360px, 60vh);
  padding: 0;
  margin: 0;
  overflow-y: auto;
  list-style: none;
}

.menu ul li {
  display: block;
}

.menu a {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 6px var(--space-2);
  border-radius: var(--radius-sm, 6px);
  color: var(--text-strong);
  gap: var(--space-3);
  text-decoration: none;
}

.menu a:hover,
.menu a:focus-visible {
  background: var(--surface-sunken);
  color: var(--text-link);
  text-decoration: none;
}

.menu-name {
  white-space: normal;
}

.menu-count {
  flex: none;
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

@media (hover: hover) {
  .has-menu:hover > .label,
  .is-open > .label {
    color: var(--text-link);
  }
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
