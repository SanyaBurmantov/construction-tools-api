<script setup lang="ts">
/**
 * The header every admin screen opens with: title, a muted line under it and
 * the screen's actions on the right. 19 pages used to carry their own copy of
 * the markup and its ~17 lines of CSS.
 */
defineProps<{ title: string, description?: string }>()
</script>

<template>
  <header class="admin-head">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="description || $slots.description">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.default" class="admin-head-actions">
      <slot />
    </div>
  </header>
</template>

<style scoped>
.admin-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.admin-head h1 {
  font-size: var(--text-2xl);
}

.admin-head p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.admin-head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
</style>
