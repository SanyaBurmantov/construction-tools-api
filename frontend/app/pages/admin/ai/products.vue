<script setup lang="ts">
import type { Brand } from '~/types/api'
import type { AiProductRow } from '~/types/ai'

definePageMeta({ layout: 'admin' })

type Category = { id: string, name: string, parentId: string | null }
type Source = { id: string, name: string }

const { adminFetch, errorMessage } = useAdminApi()
const { status, loadStatus } = useAiStatus()

const rows = ref<AiProductRow[]>([])
const pagination = ref({ page: 1, limit: 50, total: 0, pages: 0 })
const loading = ref(false)
const loadError = ref('')
const page = ref(1)

const filters = reactive({
  search: '',
  categoryId: '',
  brandId: '',
  sourceId: '',
  status: '',
  stock: '',
  missing: '',
  ai: '',
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
const brands = ref<Brand[]>([])
const sources = ref<Source[]>([])

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

async function loadReferences() {
  const [cats, brs, srcs] = await Promise.all([
    adminFetch<Category[]>('/categories').catch(() => []),
    adminFetch<Brand[]>('/brands').catch(() => []),
    adminFetch<Source[]>('/sources').catch(() => []),
  ])
  categories.value = cats
  brands.value = brs
  sources.value = srcs
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await adminFetch<{ data: AiProductRow[], pagination: typeof pagination.value }>(
      '/ai/products',
      { params: { ...filterParams(), page: page.value, limit: 50 } }
    )
    rows.value = response.data
    pagination.value = response.pagination
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить товары')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadStatus()
  void loadReferences()
  void load()
})

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
  () => [filters.categoryId, filters.brandId, filters.sourceId, filters.status, filters.stock, filters.missing, filters.ai],
  () => {
    page.value = 1
    // "All matching" means *this* filter; a new filter is a new question.
    picker.allMatching.value = false
    void load()
  }
)
watch(page, () => void load())

function resetFilters() {
  Object.assign(filters, { search: '', categoryId: '', brandId: '', sourceId: '', status: '', stock: '', missing: '', ai: '' })
}

/* ---- Selection --------------------------------------------------------- */
const pageAllPicked = computed(() => rows.value.length > 0 && rows.value.every((row) => picker.isPicked(row.id)))

const wizardOpen = ref(false)
const sample = computed(() => picker.sample.value ?? (rows.value[0] ? { id: rows.value[0].id, name: rows.value[0].name } : null))

function onCreated() {
  picker.clear()
  void loadStatus()
  void navigateTo('/admin/ai/tasks')
}

/* ---- Display ----------------------------------------------------------- */
const FILL_COLUMNS = [
  { key: 'descriptionShort', label: 'Кратк.' },
  { key: 'descriptionFull', label: 'Описание' },
  { key: 'seoTitle', label: 'Title' },
  { key: 'seoDescription', label: 'Meta' },
]

const STATUS_LABEL: Record<AiProductRow['status'], string> = {
  PUBLISHED: 'Опубликован',
  DRAFT: 'Черновик',
  HIDDEN: 'Скрыт',
  ARCHIVED: 'Архив',
}
</script>

<template>
  <div class="ai-page">
    <header class="head">
      <div>
        <h1>ИИ · Товары</h1>
        <p>Выберите товары, затем поля и промпт — модель перепишет тексты, а программа обновит карточки</p>
      </div>
      <UiButton variant="secondary" to="/admin/ai/tasks">Задачи и планировщик</UiButton>
    </header>

    <AdminAiStatusLine :status="status" />

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div class="filters">
      <UiInput v-model="filters.search" placeholder="Название или артикул" size="sm" aria-label="Поиск" />
      <UiSelect v-model="filters.categoryId" size="sm" :options="[{ value: '', label: 'Все категории' }, ...categoryOptions]" />
      <UiSelect
        v-model="filters.brandId"
        size="sm"
        :options="[{ value: '', label: 'Все бренды' }, ...brands.map((b) => ({ value: b.id, label: b.name }))]"
      />
      <UiSelect
        v-model="filters.sourceId"
        size="sm"
        :options="[{ value: '', label: 'Все поставщики' }, ...sources.map((s) => ({ value: s.id, label: s.name }))]"
      />
      <UiSelect
        v-model="filters.status"
        size="sm"
        :options="[
          { value: '', label: 'Любой статус' },
          { value: 'PUBLISHED', label: 'Опубликованные' },
          { value: 'DRAFT', label: 'Черновики' },
          { value: 'HIDDEN', label: 'Скрытые' },
          { value: 'ARCHIVED', label: 'Архив' }
        ]"
      />
      <UiSelect
        v-model="filters.stock"
        size="sm"
        :options="[
          { value: '', label: 'Любое наличие' },
          { value: 'in_stock', label: 'В наличии' },
          { value: 'out_of_stock', label: 'Нет в наличии' }
        ]"
      />
      <UiSelect
        v-model="filters.missing"
        size="sm"
        :options="[
          { value: '', label: 'Заполненность — любая' },
          { value: 'descriptionShort', label: 'Без краткого описания' },
          { value: 'descriptionFull', label: 'Без описания' },
          { value: 'seoTitle', label: 'Без SEO title' },
          { value: 'seoDescription', label: 'Без SEO description' }
        ]"
      />
      <UiSelect
        v-model="filters.ai"
        size="sm"
        :options="[
          { value: '', label: 'ИИ — неважно' },
          { value: 'no', label: 'Ещё не обработаны ИИ' },
          { value: 'yes', label: 'Уже обработаны ИИ' }
        ]"
      />
      <UiButton size="sm" variant="ghost" @click="resetFilters">Сбросить</UiButton>
    </div>

    <div class="bulk">
      <span v-if="picker.count.value">
        Выбрано: <strong>{{ picker.count.value }}</strong>
        <template v-if="picker.allMatching.value"> (все по фильтру)</template>
      </span>
      <span v-else class="muted">Найдено {{ pagination.total }} — отметьте товары или возьмите все по фильтру</span>
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
            <th>Товар</th>
            <th>Категория / бренд</th>
            <th v-for="col in FILL_COLUMNS" :key="col.key" class="num">{{ col.label }}</th>
            <th>Статус</th>
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
                <div class="product">
                  <img v-if="row.image" :src="row.image" alt="" loading="lazy">
                  <div>
                    <a :href="`/product/${row.slug}`" target="_blank" rel="noopener">{{ row.name }}</a>
                    <small v-if="row.sku">Арт. {{ row.sku }}</small>
                    <small v-if="row.aiLockedFields.length" class="ai-mark">ИИ: {{ row.aiLockedFields.length }} пол.</small>
                  </div>
                </div>
              </td>
              <td>
                <span>{{ row.category?.name }}</span>
                <small v-if="row.brand">{{ row.brand.name }}</small>
              </td>
              <td v-for="col in FILL_COLUMNS" :key="col.key" class="num">
                <span
                  class="fill"
                  :class="{
                    'is-empty': !row.lengths[col.key],
                    'is-ai': row.aiLockedFields.includes(col.key)
                  }"
                  :title="row.aiLockedFields.includes(col.key) ? 'Переписано ИИ' : undefined"
                >
                  {{ row.lengths[col.key] || '—' }}
                </span>
              </td>
              <td><UiBadge size="sm">{{ STATUS_LABEL[row.status] }}</UiBadge></td>
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
      entity="PRODUCT"
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

.product {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.product img {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  object-fit: contain;
}

.product a {
  color: var(--text-strong);
  font-weight: 600;
}

.ai-mark {
  color: var(--brand) !important;
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
