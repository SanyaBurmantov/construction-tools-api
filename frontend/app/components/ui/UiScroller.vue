<script setup lang="ts">
/**
 * Horizontal scroller with no visible scrollbar.
 *
 * Used for the category nav, tabs, breadcrumbs and the product thumbnail strip
 * — places where a native scrollbar is both ugly and, on desktop, hard to grab.
 * Deliberately not Swiper: this needs scrolling, not a carousel, and a real
 * scroll container keeps keyboard focus, wheel and touch behaviour for free.
 */
withDefaults(
  defineProps<{
    /** Shows arrow buttons on pointer devices when content overflows. */
    arrows?: boolean
    /** Fades the edges to hint that there is more content. */
    fade?: boolean
    /** Enables click-and-drag panning with a mouse. */
    drag?: boolean
    label?: string
  }>(),
  { arrows: true, fade: true, drag: true }
)

const viewport = ref<HTMLElement | null>(null)
const atStart = ref(true)
const atEnd = ref(true)
const overflowing = ref(false)

/** Tolerance for sub-pixel scroll positions in zoomed / scaled layouts. */
const EPSILON = 2

function measure() {
  const el = viewport.value
  if (!el) return
  overflowing.value = el.scrollWidth > el.clientWidth + EPSILON
  atStart.value = el.scrollLeft <= EPSILON
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - EPSILON
}

function scrollByPage(direction: -1 | 1) {
  const el = viewport.value
  if (!el) return
  // Leave a sliver of the previous item visible so the eye keeps its place.
  el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' })
}

/* ---- Drag to pan -------------------------------------------------------- */
let dragging = false
let startX = 0
let startScroll = 0
let moved = 0

function onPointerDown(event: PointerEvent) {
  // Touch already pans natively; hijacking it would break momentum scrolling.
  if (event.pointerType === 'touch') return
  dragging = true
  moved = 0
  startX = event.clientX
  startScroll = viewport.value?.scrollLeft ?? 0
}

function onPointerMove(event: PointerEvent) {
  if (!dragging || !viewport.value) return
  const delta = event.clientX - startX
  moved = Math.max(moved, Math.abs(delta))
  viewport.value.scrollLeft = startScroll - delta
}

function endDrag() {
  dragging = false
}

/**
 * Suppresses the click that follows a drag, so panning past a link doesn't
 * navigate. A few pixels of movement is a click, not a drag.
 */
function onClickCapture(event: MouseEvent) {
  if (moved > 5) {
    event.preventDefault()
    event.stopPropagation()
    moved = 0
  }
}

let observer: ResizeObserver | undefined

onMounted(() => {
  measure()
  if (viewport.value) {
    observer = new ResizeObserver(measure)
    observer.observe(viewport.value)
    // Children changing width (facet counts loading in) also shifts overflow.
    for (const child of Array.from(viewport.value.children)) {
      observer.observe(child)
    }
  }
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <div
    class="ui-scroller"
    :class="{ 'has-fade': fade, 'is-start': atStart, 'is-end': atEnd }"
  >
    <button
      v-if="arrows && overflowing && !atStart"
      type="button"
      class="arrow is-prev"
      aria-label="Прокрутить назад"
      @click="scrollByPage(-1)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div
      ref="viewport"
      class="viewport"
      :class="{ 'is-draggable': drag && overflowing }"
      :aria-label="label"
      @scroll.passive="measure"
      @pointerdown="drag && onPointerDown($event)"
      @pointermove="drag && onPointerMove($event)"
      @pointerup="endDrag"
      @pointerleave="endDrag"
      @click.capture="onClickCapture"
    >
      <slot />
    </div>

    <button
      v-if="arrows && overflowing && !atEnd"
      type="button"
      class="arrow is-next"
      aria-label="Прокрутить вперёд"
      @click="scrollByPage(1)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.ui-scroller {
  position: relative;
  min-width: 0;
}

.viewport {
  display: flex;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

/* Chrome/Safari keep a scrollbar unless this is spelled out. */
.viewport::-webkit-scrollbar {
  display: none;
}

.is-draggable {
  cursor: grab;
}

.is-draggable:active {
  cursor: grabbing;
}

/* ---- Edge fades ---- */
.has-fade::before,
.has-fade::after {
  content: '';
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;
  width: 40px;
  opacity: 1;
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.has-fade::before {
  left: 0;
  background: linear-gradient(90deg, var(--surface-card), transparent);
}

.has-fade::after {
  right: 0;
  background: linear-gradient(270deg, var(--surface-card), transparent);
}

.is-start::before,
.is-end::after {
  opacity: 0;
}

/* ---- Arrows ---- */
.arrow {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: grid;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-muted);
  place-items: center;
  box-shadow: var(--shadow-sm);
  transform: translateY(-50%);
}

.arrow:hover {
  border-color: var(--brand);
  color: var(--brand);
}

.arrow svg {
  width: 15px;
  height: 15px;
}

.is-prev {
  left: 0;
}

.is-next {
  right: 0;
}

/* Touch devices pan directly; arrows would just cover content. */
@media (hover: none) {
  .arrow {
    display: none;
  }
}
</style>
