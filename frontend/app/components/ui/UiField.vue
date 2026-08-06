<script setup lang="ts">
/** Label + hint + error wrapper shared by every form control. */
defineProps<{
  label?: string
  hint?: string
  error?: string
  required?: boolean
  for?: string
}>()
</script>

<template>
  <div class="ui-field" :class="{ 'has-error': error }">
    <label v-if="label" class="field-label" :for="$props.for">
      {{ label }}
      <span v-if="required" class="required" aria-hidden="true">*</span>
    </label>
    <slot />
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="field-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.ui-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.field-label {
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.required {
  color: var(--danger);
}

.field-hint {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.field-error {
  color: var(--danger);
  font-size: var(--text-xs);
  font-weight: 600;
}
</style>
