<script setup lang="ts">
withDefaults(
  defineProps<{
    placeholder?: string
    rows?: number
    disabled?: boolean
    invalid?: boolean
    maxlength?: number
    id?: string
  }>(),
  { rows: 4 }
)

const model = defineModel<string>()
</script>

<template>
  <textarea
    :id="id"
    v-model="model"
    class="ui-textarea"
    :class="{ 'is-invalid': invalid }"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :maxlength="maxlength"
    :aria-invalid="invalid || undefined"
  />
</template>

<style scoped>
.ui-textarea {
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-strong);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  outline: none;
  resize: vertical;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.ui-textarea:focus {
  border-color: var(--brand);
  box-shadow: var(--shadow-focus);
}

.ui-textarea::placeholder {
  color: var(--text-subtle);
}

.is-invalid {
  border-color: var(--danger);
}

.ui-textarea:disabled {
  background: var(--surface-sunken);
  opacity: 0.7;
}
</style>
