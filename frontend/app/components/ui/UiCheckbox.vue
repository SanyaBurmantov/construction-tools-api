<script setup lang="ts">
defineProps<{
  label?: string
  disabled?: boolean
  count?: number | null
}>()

const model = defineModel<boolean>()
</script>

<template>
  <label class="ui-checkbox" :class="{ 'is-disabled': disabled }">
    <input v-model="model" type="checkbox" :disabled="disabled">
    <span class="box" aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path d="M3.5 8.5l3 3 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
    <span class="text"><slot>{{ label }}</slot></span>
    <span v-if="count != null" class="count">{{ count }}</span>
  </label>
</template>

<style scoped>
.ui-checkbox {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) 0;
  cursor: pointer;
  font-size: var(--text-base);
  user-select: none;
}

.is-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.box {
  display: grid;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xs);
  background: var(--surface-card);
  color: transparent;
  place-items: center;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.box svg {
  width: 14px;
  height: 14px;
}

input:checked + .box {
  border-color: var(--brand);
  background: var(--brand);
  color: #fff;
}

input:focus-visible + .box {
  box-shadow: var(--shadow-focus);
}

.text {
  flex: 1;
  min-width: 0;
  color: var(--text-default);
  overflow-wrap: anywhere;
}

.count {
  color: var(--text-subtle);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
</style>
