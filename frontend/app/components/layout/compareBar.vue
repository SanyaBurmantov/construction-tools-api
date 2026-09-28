<script setup lang="ts">
import { useCompareStore, COMPARE_LIMIT } from '~/stores/compare'

const compare = useCompareStore()
const route = useRoute()

/** Hidden on the compare page itself — the list is already the whole screen. */
const visible = computed(() => compare.count > 0 && route.path !== '/compare')
</script>

<template>
  <ClientOnly>
    <Transition name="slide-up">
      <aside v-if="visible" class="compare-bar" aria-label="Список сравнения">
        <div class="container inner">
          <div class="thumbs">
            <NuxtLink
              v-for="item in compare.items"
              :key="item.productId"
              :to="`/product/${item.slug}`"
              class="thumb"
              :title="item.name"
            >
              <img v-if="item.image" :src="item.image" :alt="item.name" loading="lazy">
              <span v-else class="thumb-empty" aria-hidden="true" />
              <button
                type="button"
                class="remove"
                :aria-label="`Убрать ${item.name} из сравнения`"
                @click.prevent="compare.remove(item.productId)"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
              </button>
            </NuxtLink>

            <span v-for="i in COMPARE_LIMIT - compare.count" :key="`slot-${i}`" class="thumb is-slot" />
          </div>

          <div class="text">
            <strong>К сравнению: {{ compare.count }}</strong>
            <span>из {{ COMPARE_LIMIT }} товаров</span>
          </div>

          <div class="actions">
            <UiButton variant="ghost" size="sm" @click="compare.clear()">Очистить</UiButton>
            <UiButton to="/compare" size="sm">Сравнить</UiButton>
          </div>
        </div>
      </aside>
    </Transition>
  </ClientOnly>
</template>

<style scoped>
.compare-bar {
  position: sticky;
  z-index: var(--z-sticky);
  bottom: 0;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-card);
  box-shadow: var(--shadow-lg);
}

.inner {
  display: flex;
  align-items: center;
  padding: var(--space-3) 0;
  gap: var(--space-4);
}

.thumbs {
  display: flex;
  gap: var(--space-2);
}

.thumb {
  position: relative;
  display: block;
  width: 48px;
  height: 48px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xs);
  background: var(--surface-card);
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.thumb-empty,
.is-slot {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
}

.is-slot {
  border: 1px dashed var(--border-default);
  background: none;
}

.remove {
  position: absolute;
  top: -6px;
  right: -6px;
  display: grid;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  background: var(--surface-inverse);
  color: var(--text-inverse);
  place-items: center;
}

.remove svg {
  width: 11px;
  height: 11px;
}

.text {
  display: flex;
  flex-direction: column;
  margin-right: auto;
  font-size: var(--text-sm);
}

.text strong {
  color: var(--text-strong);
}

.text span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-2);
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition:
    transform var(--duration-base) var(--ease-out),
    opacity var(--duration-base) var(--ease-out);
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

@media (max-width: 640px) {
  .thumbs .is-slot {
    display: none;
  }

  .text span {
    display: none;
  }
}
</style>
