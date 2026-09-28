<script setup lang="ts" generic="T extends Record<string, unknown>">
/**
 * Data table for the admin screens. Each column can be overridden with a
 * `#cell-<key>` slot; otherwise the raw value is printed.
 *
 * Always horizontally scrollable inside its own box so the page never scrolls
 * sideways on narrow screens.
 */
defineProps<{
  columns: Array<{
    key: string
    label: string
    align?: 'start' | 'center' | 'end'
    width?: string
    nowrap?: boolean
  }>
  rows: T[]
  rowKey?: keyof T
  loading?: boolean
  emptyText?: string
}>()
</script>

<template>
  <div class="table-wrap scroll-x">
    <table class="ui-table">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            :style="{ width: column.width, textAlign: column.align || 'start' }"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td :colspan="columns.length">
            <div class="state">
              <UiSkeleton :lines="4" height="16px" />
            </div>
          </td>
        </tr>
        <tr v-else-if="!rows.length">
          <td :colspan="columns.length">
            <p class="state empty">{{ emptyText || 'Нет данных' }}</p>
          </td>
        </tr>
        <tr v-for="(row, index) in rows" v-else :key="rowKey ? String(row[rowKey]) : index">
          <td
            v-for="column in columns"
            :key="column.key"
            :style="{ textAlign: column.align || 'start' }"
            :class="{ nowrap: column.nowrap }"
          >
            <slot :name="`cell-${column.key}`" :row="row" :index="index">
              {{ row[column.key] }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-wrap {
  width: 100%;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.ui-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

th {
  position: sticky;
  z-index: 1;
  top: 0;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-default);
  vertical-align: middle;
}

tbody tr:last-child td {
  border-bottom: 0;
}

tbody tr:hover td {
  background: var(--surface-hover);
}

.nowrap {
  white-space: nowrap;
}

.state {
  padding: var(--space-4);
}

.empty {
  color: var(--text-muted);
  text-align: center;
}
</style>
