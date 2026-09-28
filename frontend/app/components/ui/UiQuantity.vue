<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    min?: number
    max?: number
    size?: 'sm' | 'md'
    disabled?: boolean
  }>(),
  { min: 1, max: 999, size: 'md' }
)

const model = defineModel<number>({ default: 1 })

function clamp(value: number) {
  if (!Number.isFinite(value)) return props.min
  return Math.max(props.min, Math.min(Math.floor(value), props.max))
}

function step(delta: number) {
  model.value = clamp(model.value + delta)
}

function onInput(event: Event) {
  model.value = clamp(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="ui-quantity" :class="`size-${size}`">
    <button
      type="button"
      :disabled="disabled || model <= min"
      aria-label="Уменьшить количество"
      @click="step(-1)"
    >
      −
    </button>
    <input
      :value="model"
      type="number"
      inputmode="numeric"
      :min="min"
      :max="max"
      :disabled="disabled"
      aria-label="Количество"
      @input="onInput"
    >
    <button
      type="button"
      :disabled="disabled || model >= max"
      aria-label="Увеличить количество"
      @click="step(1)"
    >
      +
    </button>
  </div>
</template>

<style scoped>
.ui-quantity {
  display: inline-flex;
  overflow: hidden;
  align-items: center;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
}

button {
  display: grid;
  height: 100%;
  color: var(--text-muted);
  font-size: var(--text-lg);
  font-weight: 700;
  place-items: center;
  transition: background var(--duration-fast) var(--ease-out);
}

button:hover:not(:disabled) {
  background: var(--surface-active);
  color: var(--text-strong);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

input {
  border: 0;
  border-inline: 1px solid var(--border-subtle);
  appearance: textfield;
  background: none;
  color: var(--text-strong);
  font-weight: 700;
  outline: none;
  text-align: center;
  -moz-appearance: textfield;
}

input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}

.size-sm button {
  width: 30px;
  min-height: 32px;
}

.size-sm input {
  width: 42px;
  font-size: var(--text-sm);
  min-height: 32px;
}

.size-md button {
  width: 38px;
  min-height: 42px;
}

.size-md input {
  width: 54px;
  font-size: var(--text-base);
  min-height: 42px;
}
</style>
