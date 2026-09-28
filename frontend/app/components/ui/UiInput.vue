<script setup lang="ts">
withDefaults(
  defineProps<{
    type?: string
    placeholder?: string
    disabled?: boolean
    readonly?: boolean
    invalid?: boolean
    size?: 'sm' | 'md' | 'lg'
    id?: string
    min?: number | string
    max?: number | string
    step?: number | string
    autocomplete?: string
  }>(),
  { type: 'text', size: 'md' }
)

const model = defineModel<string | number | null>()

// `blur` doesn't bubble, so a fallthrough listener on the wrapper div would
// never fire. Declaring it here re-emits from the real input instead.
const emit = defineEmits<{ blur: [FocusEvent], focus: [FocusEvent] }>()
</script>

<template>
  <div class="ui-input" :class="[`size-${size}`, { 'is-invalid': invalid, 'is-disabled': disabled }]">
    <span v-if="$slots.leading" class="affix"><slot name="leading" /></span>
    <input
      :id="id"
      v-model="model"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :min="min"
      :max="max"
      :step="step"
      :autocomplete="autocomplete"
      :aria-invalid="invalid || undefined"
      @blur="emit('blur', $event)"
      @focus="emit('focus', $event)"
    >
    <span v-if="$slots.trailing" class="affix"><slot name="trailing" /></span>
  </div>
</template>

<style scoped>
.ui-input {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.ui-input:focus-within {
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

input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--text-strong);
  outline: none;
}

input::placeholder {
  color: var(--text-subtle);
}

.size-sm {
  padding: 0 var(--space-3);
}

.size-sm input {
  font-size: var(--text-sm);
  min-height: 34px;
}

.size-md {
  padding: 0 var(--space-3);
}

.size-md input {
  font-size: var(--text-base);
  min-height: 42px;
}

.size-lg {
  padding: 0 var(--space-4);
}

.size-lg input {
  font-size: var(--text-md);
  min-height: 50px;
}

.affix {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  color: var(--text-subtle);
}
</style>
