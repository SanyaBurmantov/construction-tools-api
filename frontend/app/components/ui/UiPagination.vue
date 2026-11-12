<script setup lang="ts">
import { paginationItems } from '~/utils/pagination'

type PageHref = (page: number) => string // eslint-disable-line no-unused-vars

const props = defineProps<{
  page: number
  pages: number
  /** Total items, shown as "N of M" context when provided. */
  total?: number
  /**
   * URL of a page. When given, every page is a real `<a href>` — what a
   * crawler follows (a `<button>` pager left it the first page of every
   * category and nothing else). A plain left click still goes through
   * `change`, so the parent keeps owning navigation; a modified click (new
   * tab, new window) is left to the browser and the href.
   */
  hrefFor?: PageHref
}>()

const emit = defineEmits<{ change: [page: number] }>()

/**
 * «1 … p-1 p p+1 … last» plus anchors at p ± 4, 16, 64, … — every page of a
 * long listing a few clicks away for a crawler (utils/pagination.ts). Only a
 * pager of links gets the anchors: a button pager (admin tables, account,
 * reviews) is never crawled and keeps the compact window.
 */
const items = computed(() => paginationItems(props.page, props.pages, { anchors: Boolean(props.hrefFor) }))

function go(page: number) {
  if (page < 1 || page > props.pages || page === props.page) return
  emit('change', page)
}

function onLinkClick(event: MouseEvent, page: number) {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  go(page)
}
</script>

<template>
  <nav v-if="pages > 1" class="ui-pagination" aria-label="Постраничная навигация">
    <!-- Each number travels with its «…» (and the first/last with the arrow,
         the last with the total) as one unit that never breaks: the row may
         wrap, but an arrow, a «…» or «N шт.» is never left alone on a line. -->
    <span v-for="(item, index) in items" :key="item.page" class="unit">
      <template v-if="index === 0">
        <a
          v-if="hrefFor && page > 1"
          :href="hrefFor(page - 1)"
          class="nav"
          rel="prev"
          aria-label="Предыдущая страница"
          @click="onLinkClick($event, page - 1)"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M12 4l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
        <button
          v-else
          type="button"
          class="nav"
          :disabled="page <= 1"
          aria-label="Предыдущая страница"
          @click="go(page - 1)"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M12 4l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </template>

      <span v-if="item.gapBefore" class="gap" aria-hidden="true">…</span>
      <a
        v-if="hrefFor && item.page !== page"
        :href="hrefFor(item.page)"
        class="page"
        @click="onLinkClick($event, item.page)"
      >
        {{ item.page }}
      </a>
      <span
        v-else-if="hrefFor"
        class="page is-current"
        aria-current="page"
      >
        {{ item.page }}
      </span>
      <button
        v-else
        type="button"
        class="page"
        :class="{ 'is-current': item.page === page }"
        :aria-current="item.page === page ? 'page' : undefined"
        @click="go(item.page)"
      >
        {{ item.page }}
      </button>

      <template v-if="index === items.length - 1">
        <a
          v-if="hrefFor && page < pages"
          :href="hrefFor(page + 1)"
          class="nav"
          rel="next"
          aria-label="Следующая страница"
          @click="onLinkClick($event, page + 1)"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
        <button
          v-else
          type="button"
          class="nav"
          :disabled="page >= pages"
          aria-label="Следующая страница"
          @click="go(page + 1)"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <span v-if="total != null" class="total">{{ total }} шт.</span>
      </template>
    </span>
  </nav>
</template>

<style scoped>
.ui-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  row-gap: var(--space-2);
}

.unit {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  white-space: nowrap;
}

.page,
.nav {
  display: grid;
  min-width: 38px;
  height: 38px;
  padding: 0 var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-default);
  font-size: var(--text-sm);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  place-items: center;
  text-decoration: none;
  transition: background var(--duration-fast) var(--ease-out);
}

.page:hover:not(.is-current),
.nav:hover:not(:disabled) {
  background: var(--surface-active);
}

.is-current {
  border-color: var(--brand);
  background: var(--brand);
  color: var(--text-inverse);
}

.nav svg {
  width: 18px;
  height: 18px;
}

.nav:disabled {
  color: var(--text-subtle);
  cursor: not-allowed;
  opacity: 0.5;
}

.gap {
  padding: 0 var(--space-1);
  color: var(--text-subtle);
}

.total {
  margin-left: var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* The anchors make up to ~11 numbers: on a phone they wrap into a second
   line at a slightly smaller size instead of being hidden — they are what a
   visitor (and a crawler) jumps through a long listing by. */
@media (max-width: 560px) {
  .page,
  .nav {
    min-width: 34px;
    height: 34px;
    padding: 0 var(--space-1);
  }

  .gap {
    padding: 0;
  }

  .total {
    margin-left: var(--space-2);
  }
}
</style>
