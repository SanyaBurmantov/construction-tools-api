<script setup lang="ts">
export type Banner = {
  id: string
  title: string
  subtitle: string | null
  imageUrl: string
  mobileUrl: string | null
  linkUrl: string | null
  buttonText: string | null
  bgColor: string | null
}

const props = defineProps<{ banners: Banner[] }>()

const active = ref(0)
const paused = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

const AUTOPLAY_MS = 6000

function go(index: number) {
  const total = props.banners.length
  if (!total) return
  active.value = (index + total) % total
}

function next() {
  go(active.value + 1)
}

function start() {
  if (props.banners.length < 2) return
  // Auto-advance is decoration; respect a reduced-motion preference.
  if (import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return
  }
  stop()
  timer = setInterval(() => {
    if (!paused.value) next()
  }, AUTOPLAY_MS)
}

function stop() {
  if (timer) clearInterval(timer)
  timer = undefined
}

onMounted(start)
onBeforeUnmount(stop)
watch(() => props.banners.length, start)

// Touch swipe — the slider is most used on phones.
const touchStartX = ref(0)
function onTouchStart(event: TouchEvent) {
  touchStartX.value = event.changedTouches[0]?.clientX ?? 0
}
function onTouchEnd(event: TouchEvent) {
  const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStartX.value
  if (Math.abs(delta) < 50) return
  go(active.value + (delta < 0 ? 1 : -1))
}
</script>

<template>
  <section
    v-if="banners.length"
    class="banners"
    aria-label="Акции и предложения"
    @mouseenter="paused = true"
    @mouseleave="paused = false"
    @focusin="paused = true"
    @focusout="paused = false"
    @touchstart.passive="onTouchStart"
    @touchend.passive="onTouchEnd"
  >
    <div class="viewport">
      <component
        :is="banner.linkUrl ? 'NuxtLink' : 'div'"
        v-for="(banner, index) in banners"
        :key="banner.id"
        :to="banner.linkUrl || undefined"
        class="slide"
        :class="{ 'is-active': index === active }"
        :style="{ background: banner.bgColor || undefined }"
        :aria-hidden="index !== active"
        :tabindex="index === active ? undefined : -1"
      >
        <picture>
          <source v-if="banner.mobileUrl" :srcset="banner.mobileUrl" media="(max-width: 640px)">
          <img
            :src="banner.imageUrl"
            :alt="banner.title"
            :loading="index === 0 ? 'eager' : 'lazy'"
            :fetchpriority="index === 0 ? 'high' : undefined"
          >
        </picture>

        <div class="caption">
          <h2>{{ banner.title }}</h2>
          <p v-if="banner.subtitle">{{ banner.subtitle }}</p>
          <span v-if="banner.buttonText" class="cta">{{ banner.buttonText }}</span>
        </div>
      </component>
    </div>

    <template v-if="banners.length > 1">
      <button type="button" class="nav is-prev" aria-label="Предыдущий баннер" @click="go(active - 1)">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button type="button" class="nav is-next" aria-label="Следующий баннер" @click="go(active + 1)">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <div class="dots" role="tablist" aria-label="Выбор баннера">
        <button
          v-for="(banner, index) in banners"
          :key="banner.id"
          type="button"
          role="tab"
          :aria-selected="index === active"
          :aria-label="banner.title"
          :class="{ 'is-active': index === active }"
          @click="go(index)"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.banners {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-sunken);
}

.viewport {
  position: relative;
  aspect-ratio: 1200 / 400;
}

.slide {
  position: absolute;
  display: block;
  opacity: 0;
  inset: 0;
  pointer-events: none;
  transition: opacity var(--duration-slow) var(--ease-out);
}

.slide.is-active {
  opacity: 1;
  pointer-events: auto;
}

.slide img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Caption sits over the image with a gradient scrim so text stays legible
   whatever the artwork looks like. */
.caption {
  position: absolute;
  bottom: 0;
  left: 0;
  display: flex;
  max-width: min(560px, 70%);
  flex-direction: column;
  align-items: flex-start;
  padding: var(--space-8);
  gap: var(--space-2);
}

.caption::before {
  content: '';
  position: absolute;
  background: linear-gradient(90deg, rgb(10 15 28 / 78%), transparent);
  inset: -40% -40% -40% -100%;
  z-index: -1;
}

.caption h2 {
  color: #fff;
  font-size: var(--text-2xl);
  text-shadow: 0 1px 12px rgb(0 0 0 / 45%);
}

.caption p {
  color: rgb(255 255 255 / 88%);
  font-size: var(--text-md);
  text-shadow: 0 1px 10px rgb(0 0 0 / 45%);
}

.cta {
  padding: var(--space-2) var(--space-5);
  margin-top: var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--brand);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: 700;
}

.slide:hover .cta {
  background: var(--brand-hover);
}

/* ---- Controls ---- */
.nav {
  position: absolute;
  top: 50%;
  display: grid;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  background: rgb(255 255 255 / 85%);
  color: var(--gray-800);
  place-items: center;
  transform: translateY(-50%);
  transition: background var(--duration-fast) var(--ease-out);
}

.nav:hover {
  background: #fff;
}

.nav svg {
  width: 20px;
  height: 20px;
}

.is-prev {
  left: var(--space-3);
}

.is-next {
  right: var(--space-3);
}

.dots {
  position: absolute;
  bottom: var(--space-3);
  left: 50%;
  display: flex;
  gap: var(--space-2);
  transform: translateX(-50%);
}

.dots button {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: rgb(255 255 255 / 55%);
  transition: width var(--duration-base) var(--ease-out);
}

.dots button.is-active {
  width: 24px;
  background: #fff;
}

@media (max-width: 640px) {
  .viewport {
    aspect-ratio: 4 / 3;
  }

  .caption {
    max-width: 100%;
    padding: var(--space-5);
  }

  .caption h2 {
    font-size: var(--text-lg);
  }

  .caption p {
    font-size: var(--text-sm);
  }

  .nav {
    display: none;
  }
}
</style>
