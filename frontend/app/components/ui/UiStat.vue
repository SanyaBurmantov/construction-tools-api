<script setup lang="ts">
/** KPI tile for the admin dashboard. */
withDefaults(
  defineProps<{
    label: string
    value: string | number
    hint?: string
    tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger'
    to?: string
  }>(),
  { tone: 'neutral' }
)
</script>

<template>
  <component :is="to ? 'NuxtLink' : 'div'" :to="to" class="ui-stat" :class="[`tone-${tone}`, { 'is-link': to }]">
    <span class="label">{{ label }}</span>
    <strong class="value">{{ value }}</strong>
    <span v-if="hint" class="hint">{{ hint }}</span>
  </component>
</template>

<style scoped>
.ui-stat {
  display: flex;
  flex-direction: column;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  box-shadow: var(--shadow-xs);
  gap: var(--space-1);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.is-link:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow-sm);
}

.label {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.value {
  color: var(--text-strong);
  font-size: var(--text-2xl);
  font-weight: 800;
  letter-spacing: var(--tracking-tight);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.hint {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.tone-brand .value {
  color: var(--brand);
}

.tone-success .value {
  color: var(--success);
}

.tone-warning .value {
  color: var(--warning);
}

.tone-danger .value {
  color: var(--danger);
}
</style>
