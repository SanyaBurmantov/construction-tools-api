<script setup lang="ts">
withDefaults(
  defineProps<{
    options: Array<{ value: string | number, label: string, disabled?: boolean }>
    placeholder?: string
    disabled?: boolean
    invalid?: boolean
    size?: 'sm' | 'md'
    id?: string
  }>(),
  { size: 'md' }
)

const model = defineModel<string | number | null>()
</script>

<template>
  <div class="ui-select" :class="[`size-${size}`, { 'is-invalid': invalid, 'is-disabled': disabled }]">
    <select :id="id" v-model="model" :disabled="disabled" :aria-invalid="invalid || undefined">
      <option v-if="placeholder" :value="null" disabled>{{ placeholder }}</option>
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>
    <svg class="chevron" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </div>
</template>

<style scoped>
.ui-select {
  position: relative;
  display: flex;
  align-items: center;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.ui-select:focus-within {
  border-color: var(--brand);
  box-shadow: var(--shadow-focus);
}

.is-invalid {
  border-color: var(--danger);
}

.is-disabled {
  background: var(--surface-sunken);
  opacity: 0.7;
}

select {
  width: 100%;
  /* A <select> reports its longest option as its min-content width, so inside
     a narrow flex row it refuses to shrink and overflows the container
     instead. The label is truncated rather than the layout broken. */
  min-width: 0;
  padding: 0 var(--space-8) 0 var(--space-3);
  overflow: hidden;
  text-overflow: ellipsis;
  border: 0;
  appearance: none;
  background: none;
  color: var(--text-strong);
  cursor: pointer;
  outline: none;
}

.size-sm select {
  font-size: var(--text-sm);
  min-height: 34px;
}

.size-md select {
  font-size: var(--text-base);
  min-height: 42px;
}

.chevron {
  position: absolute;
  right: var(--space-3);
  width: 18px;
  height: 18px;
  color: var(--text-subtle);
  pointer-events: none;
}
</style>
