<script setup lang="ts">
/**
 * The «ИИ · Товары» / «ИИ · Категории» screen: filters, the bulk bar, a table
 * of rows with how long each text field is, and the wizard that turns the
 * selection into a task. The two pages were the same 330 lines with different
 * columns, so they now pass their filters and columns in and keep only what
 * is really theirs.
 *
 * `filters` is the page's reactive object, edited by the page's own inputs in
 * the `#filters` slot; every value is a string, and «Сбросить» blanks them all.
 * The `#row`/`#row-end` slots get the page's own row type back as `row`.
 */
import type { AiEntity, AiPickerRow } from '~/types/ai'

const props = defineProps<{
  title: string
  description: string
  entity: AiEntity
  /** List endpoint under `/admin`. */
  path: string
  filters: Record<string, string>
  fillColumns: Array<{ key: string, label: string }>
  /** Columns the page adds through `#columns`/`#row` and `#columns-end`/`#row-end`. */
  extraColumns: number
  /** «отметьте товары» / «отметьте категории». */
  noun: string
  errorText: string
}>()

/*
 * The row slots hand back the page's own row type (`AiProductRow`,
 * `AiCategoryRow`), which the page states in its slot annotation. A generic
 * component cannot infer it — no prop carries a row — so the slot types the
 * row loosely and the page's annotation is what gets checked.
 */
defineSlots<{
  'filters'?: () => unknown
  'columns'?: () => unknown
  'columns-end'?: () => unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  'row'?: (props: { row: any }) => unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  'row-end'?: (props: { row: any }) => unknown
}>()

const { status, loadStatus } = useAiStatus()

const { rows, pagination, loading, error: loadError, setPage } = useAdminList<AiPickerRow>(props.path, {
  params: () => ({ ...props.filters }),
  limit: 50,
  debounce: 350,
  errorText: props.errorText,
})

const picker = useAiPicker(
  () => compactParams(props.filters) as Record<string, string>,
  () => pagination.value.total,
)

// "All matching" means *this* filter; a new filter is a new question.
watch(() => ({ ...props.filters }), () => {
  picker.allMatching.value = false
})

onMounted(() => void loadStatus())

function resetFilters() {
  // The page's own object, handed over to be driven like a controller —
  // through a local reference because `vue/no-mutating-props` cannot tell.
  const filters = props.filters
  for (const key of Object.keys(filters)) filters[key] = ''
}

const pageAllPicked = computed(
  () => rows.value.length > 0 && rows.value.every(row => picker.isPicked(row.id))
)

const wizardOpen = ref(false)
const sample = computed(() => picker.sample.value
  ?? (rows.value[0] ? { id: rows.value[0].id, name: rows.value[0].name } : null))

function onCreated() {
  picker.clear()
  void loadStatus()
  void navigateTo('/admin/ai/tasks')
}

const colspan = computed(() => 1 + props.extraColumns + props.fillColumns.length)
</script>

<template>
  <div class="admin-page">
    <AdminPageHead :title="title" :description="description">
      <UiButton variant="secondary" to="/admin/ai/tasks">Задачи и планировщик</UiButton>
    </AdminPageHead>

    <AdminAiStatusLine :status="status" />

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div class="filters">
      <slot name="filters" />
      <UiButton size="sm" variant="ghost" @click="resetFilters">Сбросить</UiButton>
    </div>

    <div class="bulk">
      <span v-if="picker.count.value">
        Выбрано: <strong>{{ picker.count.value }}</strong>
        <template v-if="picker.allMatching.value"> (все по фильтру)</template>
      </span>
      <span v-else class="admin-muted">
        Найдено {{ pagination.total }} — отметьте {{ noun }} или возьмите все по фильтру
      </span>
      <UiButton
        v-if="!picker.allMatching.value && pagination.total"
        size="sm"
        variant="ghost"
        @click="picker.allMatching.value = true"
      >
        Выбрать все {{ pagination.total }} по фильтру
      </UiButton>
      <UiButton v-if="picker.count.value" size="sm" variant="ghost" @click="picker.clear()">
        Снять выделение
      </UiButton>
      <UiButton size="sm" :disabled="!picker.count.value" @click="wizardOpen = true">
        Создать задачу ИИ
      </UiButton>
    </div>

    <div class="table-wrap scroll-x">
      <table class="ai-table">
        <thead>
          <tr>
            <th class="check-col">
              <UiCheckbox
                :model-value="pageAllPicked"
                @update:model-value="picker.togglePage(rows, Boolean($event))"
              />
            </th>
            <slot name="columns" />
            <th v-for="col in fillColumns" :key="col.key" class="num">{{ col.label }}</th>
            <slot name="columns-end" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td :colspan="colspan"><UiSkeleton :lines="6" height="18px" /></td>
          </tr>
          <tr v-else-if="!rows.length">
            <td :colspan="colspan">
              <UiEmpty icon="search" title="Ничего не найдено" description="Измените фильтры" />
            </td>
          </tr>
          <template v-else>
            <tr v-for="row in rows" :key="row.id" :class="{ 'is-picked': picker.isPicked(row.id) }">
              <td class="check-col">
                <UiCheckbox
                  :model-value="picker.isPicked(row.id)"
                  @update:model-value="picker.toggle(row, Boolean($event))"
                />
              </td>
              <slot name="row" :row="row" />
              <td v-for="col in fillColumns" :key="col.key" class="num">
                <span
                  class="fill"
                  :class="{
                    'is-empty': !row.lengths[col.key],
                    'is-ai': row.aiLockedFields?.includes(col.key)
                  }"
                  :title="row.aiLockedFields?.includes(col.key) ? 'Переписано ИИ' : undefined"
                >
                  {{ row.lengths[col.key] || '—' }}
                </span>
              </td>
              <slot name="row-end" :row="row" />
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <UiPagination
      :page="pagination.page"
      :pages="pagination.pages"
      :total="pagination.total"
      @change="setPage"
    />

    <AdminAiTaskWizard
      v-model:open="wizardOpen"
      :entity="entity"
      :selection="picker.selection.value"
      :status="status"
      :preview-id="sample?.id"
      :preview-name="sample?.name"
      @created="onCreated"
    />
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: var(--space-3);
}

.bulk {
  position: sticky;
  z-index: 2;
  top: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  font-size: var(--text-sm);
  gap: var(--space-3);
}

.bulk > :last-child {
  margin-left: auto;
}

.table-wrap {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.ai-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

/* `:deep()` because the page's own columns arrive through slots and carry its scope, not this one. */
.ai-table :deep(th) {
  padding: var(--space-3);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}

.ai-table :deep(td) {
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.ai-table :deep(td small) {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.ai-table tr.is-picked :deep(td) {
  background: var(--brand-soft);
}

.check-col {
  width: 44px;
}

.ai-table :deep(.num) {
  text-align: right;
  white-space: nowrap;
}

.fill {
  color: var(--text-default);
  font-variant-numeric: tabular-nums;
}

.fill.is-empty {
  color: var(--danger);
}

.fill.is-ai {
  color: var(--brand);
  font-weight: 700;
}
</style>
