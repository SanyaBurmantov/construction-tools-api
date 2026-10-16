<script setup lang="ts" generic="T extends string, O extends { value: T, label: string, hint?: string }">
/**
 * A radio group drawn as cards (customer type, delivery, payment). The real
 * radio stays in the DOM, visually hidden, so arrows/space and screen readers
 * work as with any radio group. The `extra` slot renders on the right of each
 * card (the checkout puts the delivery cost there) and receives the option.
 */
defineProps<{
  options: readonly O[]
  legend: string
  /** Keeps the legend for screen readers only, when a card title already says it. */
  hideLegend?: boolean
}>()

const model = defineModel<T>({ required: true })
</script>

<template>
  <fieldset class="ui-radio-cards">
    <legend :class="hideLegend ? 'sr-only' : 'legend'">{{ legend }}</legend>
    <label
      v-for="option in options"
      :key="option.value"
      class="option"
      :class="{ 'is-active': model === option.value }"
    >
      <input v-model="model" type="radio" :value="option.value">
      <span class="option-body">
        <span class="option-label">{{ option.label }}</span>
        <span v-if="option.hint" class="option-hint">{{ option.hint }}</span>
      </span>
      <slot name="extra" :option="option" />
    </label>
  </fieldset>
</template>

<style scoped>
.ui-radio-cards {
  display: grid;
  padding: 0;
  border: 0;
  margin: 0;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
}

.legend {
  margin-bottom: var(--space-2);
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.option {
  /* Anchors the visually hidden input, so it cannot scroll the page. */
  position: relative;
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  cursor: pointer;
  gap: var(--space-3);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}

.option:hover {
  border-color: var(--border-strong);
}

.option.is-active {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.option input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.option:has(input:focus-visible) {
  box-shadow: var(--shadow-focus);
}

.option-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.option-label {
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.option-hint {
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>
