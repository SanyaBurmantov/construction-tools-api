<template>
  <button
      class="ui-btn"
      :class="[
      `ui-btn--${variant}`,
      `ui-btn--${size}`,
      { 'ui-btn--block': block },
    ]"
      v-bind="$attrs"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps<{
  variant?: 'primary' | 'secondary' | 'outline' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  disabled?: boolean
}>()
</script>

<style scoped>
.ui-btn {
  border: none;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  transition: 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* sizes */
.ui-btn--sm { padding: 6px 12px; font-size: 14px; }
.ui-btn--md { padding: 10px 16px; font-size: 15px; }
.ui-btn--lg { padding: 14px 20px; font-size: 17px; }

.ui-btn--block { width: 100%; }

/* variants */
.ui-btn--primary {
  background: var(--color-primary);
  color: var(--color-text-light);
}
.ui-btn--primary:hover {
  background: var(--color-primary-hover);
}

.ui-btn--secondary {
  background: var(--color-bg-light);
  color: var(--color-primary);
}

.ui-btn--outline {
  background: transparent;
  border: 2px solid var(--color-primary);
  color: var(--color-primary);
}

.ui-btn--danger {
  background: #e74c3c;
  color: white;
}
.ui-btn--danger:hover {
  background: #c0392b;
}
</style>
