<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'info' | 'success' | 'warning' | 'danger'
    title?: string
  }>(),
  { tone: 'info' }
)
</script>

<template>
  <div class="ui-alert" :class="`tone-${tone}`" role="alert">
    <div class="content">
      <strong v-if="title">{{ title }}</strong>
      <p><slot /></p>
    </div>
    <div v-if="$slots.actions" class="actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.ui-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  gap: var(--space-4);
}

.content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

strong {
  font-weight: 700;
}

.actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-2);
}

.tone-info {
  border-color: var(--brand-soft);
  background: var(--brand-soft);
  color: var(--brand-soft-text);
}

.tone-success {
  border-color: var(--success-soft);
  background: var(--success-soft);
  color: var(--success-soft-text);
}

.tone-warning {
  border-color: var(--warning-soft);
  background: var(--warning-soft);
  color: var(--warning-soft-text);
}

.tone-danger {
  border-color: var(--danger-soft);
  background: var(--danger-soft);
  color: var(--danger-soft-text);
}
</style>
