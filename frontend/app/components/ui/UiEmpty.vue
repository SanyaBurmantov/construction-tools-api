<script setup lang="ts">
import type { IconName } from './UiIcon.vue'

withDefaults(
  defineProps<{
    title: string
    description?: string
    icon?: IconName
  }>(),
  { description: undefined, icon: 'box' }
)
</script>

<template>
  <div class="ui-empty">
    <div class="icon">
      <UiIcon :name="icon" :size="26" :stroke-width="1.5" />
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
