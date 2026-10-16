<script setup lang="ts">
/**
 * A catalogue photo in a square box: IPX first, then the supplier's own URL,
 * then the placeholder (see useResilientImage). The card and the list row
 * used to carry identical copies of this chain.
 *
 * width/height give the <img> an intrinsic size (no layout shift before CSS);
 * `fit="inside"` makes IPX scale *within* that box instead of cropping to it,
 * and also caps tall photos that a bare `w_300` used to deliver at full height.
 */
const props = withDefaults(
  defineProps<{
    src?: string | null
    alt: string
    /** Rendered box in CSS pixels; the x2 density is generated from it. */
    width: number
    /** Above-the-fold photos load eagerly and are preloaded (LCP). */
    priority?: boolean
  }>(),
  { src: null, priority: false }
)

const { stage, imageElement, onLoad, onError } = useResilientImage(() => props.src)
</script>

<template>
  <NuxtImg
    v-if="src && stage === 'ipx'"
    ref="imageElement"
    class="thumb"
    :src="src"
    :alt="alt"
    :sizes="`${width}px`"
    :width="width"
    :height="width"
    fit="inside"
    densities="x1 x2"
    :loading="priority ? 'eager' : 'lazy'"
    :fetchpriority="priority ? 'high' : 'auto'"
    :preload="priority || undefined"
    decoding="async"
    @load="onLoad"
    @error="onError"
  />
  <img
    v-else-if="src && stage === 'direct'"
    class="thumb"
    :src="src"
    :alt="alt"
    :width="width"
    :height="width"
    :loading="priority ? 'eager' : 'lazy'"
    decoding="async"
    @error="onError"
  >
  <span v-else class="placeholder" aria-hidden="true">
    <UiIcon name="box" :stroke-width="1.2" />
  </span>
</template>

<style scoped>
.thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  mix-blend-mode: var(--image-blend);
}

.placeholder {
  display: grid;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-subtle);
  place-items: center;
}

.placeholder svg {
  width: 40%;
  max-width: 56px;
  height: auto;
}
</style>
