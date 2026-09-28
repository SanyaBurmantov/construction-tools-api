<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'sale'
    size?: 'sm' | 'md'
    dot?: boolean
  }>(),
  { tone: 'neutral', size: 'md' }
)
</script>

<template>
  <span class="ui-badge" :class="[`tone-${tone}`, `size-${size}`]">
    <span v-if="dot" class="dot" aria-hidden="true" />
    <slot />
  </span>
</template>

<style scoped>
.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  border-radius: var(--radius-full);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.size-sm {
  padding: 4px var(--space-2);
  font-size: 11px;
}

.size-md {
  padding: 6px var(--space-3);
  font-size: var(--text-xs);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentcolor;
}

.tone-neutral {
  background: var(--surface-sunken);
  color: var(--text-muted);
}

.tone-brand {
  background: var(--brand-soft);
  color: var(--brand-soft-text);
}

.tone-success {
  background: var(--success-soft);
  color: var(--success-soft-text);
}

.tone-warning {
  background: var(--warning-soft);
  color: var(--warning-soft-text);
}

.tone-danger {
  background: var(--danger-soft);
  color: var(--danger-soft-text);
}

.tone-info {
  background: var(--info-soft);
  color: var(--info-soft-text);
}

.tone-sale {
  background: var(--sale);
  color: #fff;
}
</style>
