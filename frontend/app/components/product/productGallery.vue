<script setup lang="ts">
  type GalleryImage = { id?: string; url: string; alt?: string | null }

  const props = defineProps<{
    images: GalleryImage[]
    name: string
  }>()

  const activeIndex = ref(0)
  const zoomOpen = ref(false)
  const thumbnails = ref<HTMLElement | null>(null)
  const failedImages = ref(new Set<string>())
  const selectedImage = computed(() => props.images[activeIndex.value])
  const hasImage = computed(
    () => selectedImage.value && !failedImages.value.has(selectedImage.value.url)
  )
  const multiple = computed(() => props.images.length > 1)
  const prefersReducedMotion = ref(false)

  watch(
    () => props.images,
    () => {
      activeIndex.value = 0
      zoomOpen.value = false
      failedImages.value = new Set()
    }
  )

  onMounted(() => {
    prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.addEventListener('keydown', onZoomKeydown)
  })

  onBeforeUnmount(() => document.removeEventListener('keydown', onZoomKeydown))

  function onZoomKeydown(event: KeyboardEvent) {
    if (zoomOpen.value && !event.defaultPrevented) onKeydown(event)
  }

  function selectImage(index: number) {
    if (!props.images.length) return
    activeIndex.value = (index + props.images.length) % props.images.length
    nextTick(() => {
      const strip = thumbnails.value
      const thumbnail = strip?.children[activeIndex.value] as HTMLElement | undefined
      if (!strip || !thumbnail) return
      strip.scrollTo({
        left: thumbnail.offsetLeft - (strip.clientWidth - thumbnail.clientWidth) / 2,
        behavior: prefersReducedMotion.value ? 'instant' : 'smooth'
      })
    })
  }

  function onKeydown(event: KeyboardEvent) {
    if (!multiple.value) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      selectImage(activeIndex.value + (event.key === 'ArrowLeft' ? -1 : 1))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      selectImage(event.key === 'Home' ? 0 : props.images.length - 1)
    }
  }

  let touchStart: { x: number; y: number } | undefined
  let suppressClick = false

  function onTouchStart(event: TouchEvent) {
    suppressClick = false
    const touch = event.touches[0]
    touchStart =
      event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : undefined
  }

  function onTouchEnd(event: TouchEvent) {
    const touch = event.changedTouches[0]
    if (!touchStart || !touch) return
    const dx = touch.clientX - touchStart.x
    const dy = touch.clientY - touchStart.y
    touchStart = undefined
    if (multiple.value && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      suppressClick = true
      selectImage(activeIndex.value + (dx < 0 ? 1 : -1))
    }
  }

  function openZoom() {
    if (!suppressClick && hasImage.value) zoomOpen.value = true
    suppressClick = false
  }
</script>

<template>
  <section class="product-gallery" aria-label="Фотографии товара" @keydown="onKeydown">
    <div
      class="gallery-stage"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
      @touchcancel="touchStart = undefined"
    >
      <div v-if="$slots.default" class="gallery-flags"><slot /></div>
      <button
        v-if="hasImage && selectedImage"
        type="button"
        class="gallery-image"
        aria-label="Увеличить фотографию товара"
        @click="openZoom"
      >
        <img
          :key="selectedImage.url"
          :src="selectedImage.url"
          :alt="selectedImage.alt || name"
          fetchpriority="high"
          draggable="false"
          @error="failedImages.add(selectedImage.url)"
        >
        <span class="zoom-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg>
        </span>
      </button>
      <div v-else class="gallery-empty" role="img" :aria-label="`Нет фотографии: ${name}`">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 8l8-4 8 4v8l-8 4-8-4V8zm0 0l8 4m0 0l8-4m-8 4v8" />
        </svg>
        <span>Фото пока нет</span>
      </div>
      <template v-if="multiple">
        <button
          type="button"
          class="gallery-arrow is-prev"
          aria-label="Предыдущее фото"
          @click="selectImage(activeIndex - 1)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
        </button>
        <button
          type="button"
          class="gallery-arrow is-next"
          aria-label="Следующее фото"
          @click="selectImage(activeIndex + 1)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
        </button>
        <span class="gallery-count" aria-live="polite" aria-atomic="true"
          >{{ activeIndex + 1 }} / {{ images.length }}</span
        >
      </template>
    </div>

    <div v-if="multiple" ref="thumbnails" class="gallery-thumbnails" aria-label="Выбор фотографии">
      <button
        v-for="(image, index) in images"
        :key="image.id || `${image.url}-${index}`"
        type="button"
        class="gallery-thumbnail"
        :class="{ 'is-active': index === activeIndex }"
        :aria-label="`Показать фото ${index + 1}`"
        :aria-current="index === activeIndex ? 'true' : undefined"
        @click="selectImage(index)"
      >
        <img :src="image.url" :alt="image.alt || name" loading="lazy" draggable="false" >
      </button>
    </div>

    <UiModal v-model:open="zoomOpen" size="xl" :title="name">
      <div
        class="gallery-stage is-zoom"
        @keydown="onKeydown"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
        @touchcancel="touchStart = undefined"
      >
        <img
          v-if="hasImage && selectedImage"
          :src="selectedImage.url"
          :alt="selectedImage.alt || name"
          class="zoom-image"
          draggable="false"
          @error="failedImages.add(selectedImage.url)"
        >
        <div v-else class="gallery-empty">Фото пока нет</div>
        <template v-if="multiple">
          <button
            type="button"
            class="gallery-arrow is-prev"
            aria-label="Предыдущее фото"
            @click="selectImage(activeIndex - 1)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
          </button>
          <button
            type="button"
            class="gallery-arrow is-next"
            aria-label="Следующее фото"
            @click="selectImage(activeIndex + 1)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
          </button>
          <span class="gallery-count" aria-live="polite" aria-atomic="true"
            >{{ activeIndex + 1 }} / {{ images.length }}</span
          >
        </template>
      </div>
    </UiModal>
  </section>
</template>

<style scoped>
  .product-gallery {
    position: sticky;
    top: calc(var(--header-height) + var(--space-4));
    min-width: 0;
  }

  .gallery-stage {
    position: relative;
    height: 480px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: #fff;
    touch-action: pan-y pinch-zoom;
  }

  .gallery-flags {
    position: absolute;
    z-index: 1;
    top: var(--space-4);
    left: var(--space-4);
    pointer-events: none;
  }

  .gallery-image,
  .gallery-empty {
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    padding: 48px 56px;
  }

  .gallery-image {
    cursor: zoom-in;
  }

  .gallery-image img,
  .zoom-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .gallery-empty {
    flex-direction: column;
    color: var(--text-subtle);
    gap: var(--space-3);
  }

  .gallery-empty svg {
    width: 72px;
    height: 72px;
  }

  .gallery-arrow svg,
  .gallery-empty svg,
  .zoom-hint svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .zoom-hint {
    position: absolute;
    right: 16px;
    bottom: 16px;
    display: grid;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: #fff;
    color: var(--text-muted);
    place-items: center;
  }

  .zoom-hint svg {
    width: 18px;
    height: 18px;
  }

  .gallery-arrow {
    position: absolute;
    z-index: 2;
    top: 50%;
    display: grid;
    width: 40px;
    height: 40px;
    border: 1px solid var(--border-subtle);
    border-radius: 50%;
    background: #fff;
    color: var(--text-strong);
    box-shadow: var(--shadow-sm);
    transform: translateY(-50%);
    transition:
      border-color var(--duration-fast),
      color var(--duration-fast);
    place-items: center;
  }

  .gallery-arrow:hover {
    border-color: var(--brand);
    color: var(--brand);
  }

  .gallery-arrow svg {
    width: 20px;
    height: 20px;
  }

  .is-prev {
    left: 12px;
  }
  .is-next {
    right: 12px;
  }

  .gallery-count {
    position: absolute;
    bottom: 16px;
    left: 50%;
    padding: 4px 12px;
    border-radius: var(--radius-full);
    background: var(--surface-active);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    transform: translateX(-50%);
  }

  .gallery-thumbnails {
    position: relative;
    display: flex;
    overflow-x: auto;
    padding: 4px;
    margin-top: 12px;
    gap: 10px;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--border-subtle) transparent;
    scroll-snap-type: x proximity;
  }

  .gallery-thumbnail {
    width: 76px;
    height: 76px;
    flex: 0 0 76px;
    padding: 8px;
    border: 2px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: #fff;
    scroll-snap-align: center;
    transition: border-color var(--duration-fast);
  }

  .gallery-thumbnail:hover {
    border-color: var(--border-strong);
  }
  .gallery-thumbnail.is-active {
    border-color: var(--brand);
  }

  .gallery-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .gallery-image:focus-visible {
    outline-offset: -4px;
  }

  .is-zoom {
    height: min(65dvh, 680px);
    border: 0;
  }

  .zoom-image {
    padding: 32px 56px;
  }

  @media (max-width: 1024px) {
    .product-gallery {
      position: static;
    }
    .gallery-stage {
      height: 360px;
    }
    .is-zoom {
      height: 60dvh;
    }
  }

  @media (max-width: 640px) {
    .gallery-stage {
      height: 300px;
    }
    .gallery-image {
      padding: 40px 48px;
    }
    .gallery-arrow {
      width: 36px;
      height: 36px;
    }
    .is-prev {
      left: 8px;
    }
    .is-next {
      right: 8px;
    }
    .gallery-thumbnail {
      width: 64px;
      height: 64px;
      flex-basis: 64px;
    }
    .is-zoom {
      height: 55dvh;
    }
    .zoom-image {
      padding: 32px 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .gallery-arrow,
    .gallery-thumbnail {
      transition: none;
    }
  }
</style>
