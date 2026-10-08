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
const draft = ref(String(model.value))
const editing = ref(false)

watch(model, (value) => {
  if (!editing.value) draft.value = String(value)
})

function clamp(value: number) {
  if (!Number.isFinite(value)) return props.min
  return Math.max(props.min, Math.min(Math.floor(value), props.max))
}

function step(delta: number) {
  const next = clamp(model.value + delta)
  draft.value = String(next)
  model.value = next
}

function onInput(event: Event) {
  editing.value = true
  draft.value = (event.target as HTMLInputElement).value
  const value = Number(draft.value)
  // Keep unfinished edits visible without putting invalid quantities in the cart.
  if (draft.value !== '' && Number.isInteger(value) && value >= props.min && value <= props.max) {
    model.value = value
  }
}

function commit() {
  editing.value = false
  const next = clamp(Number(draft.value))
  draft.value = String(next)
  model.value = next
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
      :value="draft"
      type="number"
      inputmode="numeric"
      :min="min"
      :max="max"
      :disabled="disabled"
      aria-label="Количество"
      @focus="editing = true"
      @input="onInput"
      @blur="commit"
      @keydown.enter.prevent="commit"
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

input:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: -2px;
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
