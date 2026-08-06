<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    padded?: boolean
    /** Flat cards drop the shadow — for cards sitting inside another surface. */
    flat?: boolean
  }>(),
  { padded: true }
)
</script>

<template>
  <section class="ui-card" :class="{ 'is-flat': flat }">
    <header v-if="title || $slots.header" class="card-header">
      <slot name="header">
        <h3>{{ title }}</h3>
      </slot>
      <div v-if="$slots.actions" class="card-actions">
        <slot name="actions" />
      </div>
    </header>
    <div :class="{ 'card-body': padded }">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.ui-card {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
}

.is-flat {
  box-shadow: none;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  gap: var(--space-4);
}

.card-header h3 {
  font-size: var(--text-lg);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.card-body {
  padding: var(--space-5);
}
</style>
