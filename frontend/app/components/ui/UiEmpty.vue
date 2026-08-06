<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description?: string
    icon?: 'search' | 'box' | 'cart' | 'heart' | 'alert'
  }>(),
  { icon: 'box' }
)

const PATHS: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm7.5 14.5L16 16',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4V8zm0 0l8 4m0 0l8-4m-8 4v8',
  cart: 'M3 4h2l2.4 10.4A2 2 0 0 0 9.35 16H17a2 2 0 0 0 1.95-1.55L20.5 8H6M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  heart: 'M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5C19 15.5 12 20 12 20z',
  alert: 'M12 8v5m0 3h.01M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
}
</script>

<template>
  <div class="ui-empty">
    <div class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path
          :d="PATHS[icon]"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
    <div v-if="$slots.default" class="actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-12) var(--space-6);
  text-align: center;
}

.icon {
  display: grid;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-full);
  margin-bottom: var(--space-4);
  background: var(--surface-sunken);
  color: var(--text-subtle);
  place-items: center;
}

.icon svg {
  width: 26px;
  height: 26px;
}

h3 {
  margin-bottom: var(--space-2);
  font-size: var(--text-lg);
}

p {
  max-width: 46ch;
  color: var(--text-muted);
  font-size: var(--text-base);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: var(--space-5);
  gap: var(--space-3);
}
</style>
