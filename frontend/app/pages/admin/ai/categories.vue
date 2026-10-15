<script setup lang="ts">
import type { AiCategoryRow } from '~/types/ai'

definePageMeta({ layout: 'admin' })

type Category = { id: string, name: string, parentId: string | null }

const { adminFetch, errorMessage } = useAdminApi()
const { status, loadStatus } = useAiStatus()

const rows = ref<AiCategoryRow[]>([])
const pagination = ref({ page: 1, limit: 50, total: 0, pages: 0 })
const loading = ref(false)
const loadError = ref('')
const page = ref(1)

const filters = reactive({
  search: '',
  parentId: '',
  level: '',
  visible: '',
  missing: '',
})

function filterParams() {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(filters)) {
    const text = value.trim()
    if (text) params[key] = text
  }
  return params
}

const picker = useAiPicker(filterParams, () => pagination.value.total)

/* ---- References -------------------------------------------------------- */
const categories = ref<Category[]>([])

/** Flat list in tree order, so the indentation in the <select> means nesting. */
const categoryOptions = computed(() => {
  const byParent = new Map<string | null, Category[]>()
  for (const category of categories.value) {
    const list = byParent.get(category.parentId) ?? []
    list.push(category)
    byParent.set(category.parentId, list)
  }
  const out: Array<{ value: string, label: string }> = []
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    for (const child of children) {
      out.push({ value: child.id, label: `${'— '.repeat(depth)}${child.name}` })
      walk(child.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await adminFetch<{ data: AiCategoryRow[], pagination: typeof pagination.value }>(
      '/ai/categories',
      { params: { ...filterParams(), page: page.value, limit: 50 } }
    )
    rows.value = response.data
    pagination.value = response.pagination
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить категории')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  void loadStatus()
  categories.value = await adminFetch<Category[]>('/categories').catch(() => [])
})
onMounted(() => void load())

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(() => filters.search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    picker.allMatching.value = false
    void load()
  }, 350)
})
watch(
  () => [filters.parentId, filters.level, filters.visible, filters.missing],
  () => {
    page.value = 1
    picker.allMatching.value = false
    void load()
  }
)
watch(page, () => void load())

function resetFilters() {
  Object.assign(filters, { search: '', parentId: '', level: '', visible: '', missing: '' })
}

const pageAllPicked = computed(() => rows.value.length > 0 && rows.value.every((row) => picker.isPicked(row.id)))

const wizardOpen = ref(false)
const sample = computed(() => picker.sample.value ?? (rows.value[0] ? { id: rows.value[0].id, name: rows.value[0].name } : null))

function onCreated() {
  picker.clear()
  void loadStatus()
  void navigateTo('/admin/ai/tasks')
}

const FILL_COLUMNS = [
  { key: 'description', label: 'Описание' },
  { key: 'seoTitle', label: 'Title' },
  { key: 'seoDescription', label: 'Meta' },
]
</script>

<template>
  <div class="ai-page">
    <header class="head">
      <div>
        <h1>ИИ · Категории</h1>
        <p>Выберите категории, затем поля и промпт — модель перепишет описания и SEO</p>
      </div>
      <UiButton variant="secondary" to="/admin/ai/tasks">Задачи и планировщик</UiButton>
    </header>

    <AdminAiStatusLine :status="status" />

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div class="filters">
      <UiInput v-model="filters.search" placeholder="Название категории" size="sm" aria-label="Поиск" />
      <UiSelect v-model="filters.parentId" size="sm" :options="[{ value: '', label: 'Все ветки' }, ...categoryOptions]" />
      <UiSelect
        v-model="filters.level"
        size="sm"
        :options="[
          { value: '', label: 'Любой уровень' },
          { value: '0', label: 'Корневые' },
          { value: '1', label: 'Уровень 2' },
          { value: '2', label: 'Уровень 3' },
          { value: '3', label: 'Уровень 4' }
        ]"
      />
      <UiSelect
        v-model="filters.visible"
        size="sm"
        :options="[
          { value: '', label: 'Видимые и скрытые' },
          { value: 'yes', label: 'Видимые' },
          { value: 'no', label: 'Скрытые' }
        ]"
      />
      <UiSelect
        v-model="filters.missing"
        size="sm"
        :options="[
          { value: '', label: 'Заполненность — любая' },
          { value: 'description', label: 'Без описания' }
        ]"
      />
      <UiButton size="sm" variant="ghost" @click="resetFilters">Сбросить</UiButton>
    </div>

    <div class="bulk">
      <span v-if="picker.count.value">
        Выбрано: <strong>{{ picker.count.value }}</strong>
        <template v-if="picker.allMatching.value"> (все по фильтру)</template>
      </span>
      <span v-else class="muted">Найдено {{ pagination.total }} — отметьте категории или возьмите все по фильтру</span>
      <UiButton
        v-if="!picker.allMatching.value && pagination.total"
        size="sm"
        variant="ghost"
        @click="picker.allMatching.value = true"
      >
        Выбрать все {{ pagination.total }} по фильтру
      </UiButton>
      <UiButton v-if="picker.count.value" size="sm" variant="ghost" @click="picker.clear()">Снять выделение</UiButton>
      <UiButton size="sm" :disabled="!picker.count.value" @click="wizardOpen = true">Создать задачу ИИ</UiButton>
    </div>

    <div class="table-wrap scroll-x">
      <table class="ai-table">
        <thead>
          <tr>
            <th class="check-col">
              <UiCheckbox :model-value="pageAllPicked" @update:model-value="picker.togglePage(rows, Boolean($event))" />
            </th>
            <th>Категория</th>
            <th>Родитель</th>
            <th class="num">Товаров</th>
            <th v-for="col in FILL_COLUMNS" :key="col.key" class="num">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td :colspan="4 + FILL_COLUMNS.length"><UiSkeleton :lines="6" height="18px" /></td>
          </tr>
          <tr v-else-if="!rows.length">
            <td :colspan="4 + FILL_COLUMNS.length">
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
              <td>
                <a :href="`/catalog/${row.slug}`" target="_blank" rel="noopener" class="name">{{ row.name }}</a>
                <small>Уровень {{ row.level + 1 }}<template v-if="!row.isVisible"> · скрыта</template></small>
              </td>
              <td>{{ row.parent?.name ?? '—' }}</td>
              <td class="num">{{ row._count.products }}</td>
              <td v-for="col in FILL_COLUMNS" :key="col.key" class="num">
                <span
                  class="fill"
                  :class="{
                    'is-empty': !row.lengths[col.key]
                  }"
                >
                  {{ row.lengths[col.key] || '—' }}
                </span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <UiPagination
      v-if="pagination.pages > 1"
      :page="page"
      :pages="pagination.pages"
      :total="pagination.total"
      @change="page = $event"
    />

    <AdminAiTaskWizard
      v-model:open="wizardOpen"
      entity="CATEGORY"
      :selection="picker.selection.value"
      :status="status"
      :preview-id="sample?.id"
      :preview-name="sample?.name"
      @created="onCreated"
    />
  </div>
</template>

<style scoped>
.ai-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.head h1 {
  font-size: var(--text-2xl);
}

.head p,
.muted {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

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

.ai-table th {
  padding: var(--space-3);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}

.ai-table td {
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.ai-table td small {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.ai-table tr.is-picked td {
  background: var(--brand-soft);
}

.check-col {
  width: 44px;
}

.num {
  text-align: right !important;
  white-space: nowrap;
}

.name {
  color: var(--text-strong);
  font-weight: 600;
}

.fill {
  color: var(--text-default);
  font-variant-numeric: tabular-nums;
}

.fill.is-empty {
  color: var(--danger);
}
</style>
