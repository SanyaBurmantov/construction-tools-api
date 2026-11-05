<script setup lang="ts">
defineProps<{
  tabs: Array<{ value: string, label: string, count?: number | null }>
}>()

const model = defineModel<string>({ required: true })
</script>

<template>
  <div class="ui-tabs scroll-x" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      class="tab"
      :class="{ 'is-active': model === tab.value }"
      :aria-selected="model === tab.value"
      @click="model = tab.value"
    >
      {{ tab.label }}
      <span v-if="tab.count != null" class="count">{{ tab.count }}</span>
    </button>
  </div>
</template>

<style scoped>
/* The row's bottom line is an inset shadow, so the active tab's underline
   covers it without hanging 1px below the row: that pixel (it used to be
   margin-bottom: -1px over a border) made a vertical scrollbar on Windows in
   this sideways-scrolling row. */
.ui-tabs {
  display: flex;
  overflow-y: hidden;
  box-shadow: inset 0 -1px 0 var(--border-subtle);
  gap: var(--space-1);
}

.tab {
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 700;
  gap: var(--space-2);
  transition:
    color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
  white-space: nowrap;
}

.tab:hover {
  color: var(--text-strong);
}

.is-active {
  border-bottom-color: var(--brand);
  color: var(--brand);
}

.count {
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: 11px;
}

.is-active .count {
  background: var(--brand-soft);
  color: var(--brand-soft-text);
}
</style>
