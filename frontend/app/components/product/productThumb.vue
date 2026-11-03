<script setup lang="ts">
/**
 * A catalogue photo in a square box. A photo already copied to our S3 is a
 * set of ready WebP sizes (utils/media-variants.ts): it is served as a plain
 * <img srcset> straight from the bucket — no IPX, no supplier. Anything else:
 * IPX first, then the supplier's own URL, then the placeholder (see
 * useResilientImage). The card and the list row
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
    /** Defaults to `width` (a square box); category tiles are 4:3. */
    height?: number
    /** Above-the-fold photos load eagerly and are preloaded (LCP). */
    priority?: boolean
  }>(),
  { src: null, priority: false, height: undefined }
)

const boxHeight = computed(() => props.height ?? props.width)

const { stage, imageElement, onLoad, onError } = useResilientImage(() => props.src)

const stored = computed(() => isStoredVariant(props.src))
const storedSrc = computed(() => (stored.value ? mediaSrc(props.src!, props.width) : null))
const storedSrcset = computed(() => (stored.value ? mediaSrcset(props.src!, props.width) : undefined))

// NuxtImg's `preload` for the LCP photo, done by hand for the stored sizes.
useHead(() => (props.priority && storedSrc.value
  ? {
      link: [{
        key: `thumb-preload-${storedSrc.value}`,
        rel: 'preload',
        as: 'image',
        href: storedSrc.value,
        imagesrcset: storedSrcset.value,
        fetchpriority: 'high',
      }],
    }
  : {}))
</script>

<template>
  <img
    v-if="src && stored && stage === 'ipx'"
    ref="imageElement"
    class="thumb"
    :src="storedSrc!"
    :srcset="storedSrcset"
    :alt="alt"
    :width="width"
    :height="boxHeight"
    :loading="priority ? 'eager' : 'lazy'"
    :fetchpriority="priority ? 'high' : 'auto'"
    decoding="async"
    @load="onLoad"
    @error="onError"
  >
  <NuxtImg
    v-else-if="src && stage === 'ipx'"
    ref="imageElement"
    class="thumb"
    :src="src"
    :alt="alt"
    :sizes="`${width}px`"
    :width="width"
    :height="boxHeight"
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
    :height="boxHeight"
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
