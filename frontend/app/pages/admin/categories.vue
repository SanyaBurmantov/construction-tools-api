<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type Category = {
  id: string
  name: string
  slug: string
  parentId: string | null
  level: number
  path: string[]
  description: string | null
  seoTitle: string
  seoDescription: string
  _count?: { products: number }
}

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()

const categories = ref<Category[]>([])
const loading = ref(false)
const loadError = ref('')
const search = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    categories.value = await adminFetch<Category[]>('/categories')
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить категории')
  } finally {
    loading.value = false
  }
}

onMounted(load)

/**
 * The API returns a flat list; rebuild the tree so nesting is visible and
 * children stay under their parent.
 */
type TreeNode = Category & { children: TreeNode[] }

const tree = computed<TreeNode[]>(() => {
  const byId = new Map<string, TreeNode>()
  for (const category of categories.value) {
    byId.set(category.id, { ...category, children: [] })
  }

  const roots: TreeNode[] = []
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    nodes.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
})

/** Flattened tree with depth, filtered by the search box. */
const rows = computed(() => {
  const query = search.value.trim().toLowerCase()
  const result: Array<TreeNode & { depth: number }> = []

  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      const matches = !query || node.name.toLowerCase().includes(query)
        || node.slug.toLowerCase().includes(query)
      // Keep a branch when it matches or any descendant does.
      const childResult: Array<TreeNode & { depth: number }> = []
      const before = result.length
      walk(node.children, depth + 1)
      childResult.push(...result.splice(before))

      if (matches || childResult.length) {
        result.push({ ...node, depth })
        result.push(...childResult)
      }
    }
  }

  walk(tree.value, 0)
  return result
})

const collapsed = ref<Set<string>>(new Set())

/** A row is hidden when any of its ancestors is collapsed. */
const visibleRows = computed(() => {
  const hiddenUnder: string[] = []
  return rows.value.filter((row) => {
    while (hiddenUnder.length && !isDescendant(row, hiddenUnder[hiddenUnder.length - 1]!)) {
      hiddenUnder.pop()
    }
    const hidden = hiddenUnder.length > 0
    if (!hidden && collapsed.value.has(row.id)) hiddenUnder.push(row.id)
    return !hidden
  })
})

function isDescendant(row: Category, ancestorId: string) {
  const ancestor = categories.value.find((c) => c.id === ancestorId)
  if (!ancestor) return false
  // `path` holds the slug chain from the root, so containment means descent.
  return row.path.length > ancestor.path.length
    && ancestor.path.every((slug, index) => row.path[index] === slug)
}

function toggleCollapse(id: string) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

function hasChildren(id: string) {
  return categories.value.some((c) => c.parentId === id)
}

/* ---- Editor ------------------------------------------------------------ */
const editorOpen = ref(false)
const saving = ref(false)
const editing = ref<Category | null>(null)
const formError = ref('')

const blankForm = () => ({
  name: '',
  slug: '',
  parentId: '',
  description: '',
  seoTitle: '',
  seoDescription: '',
})
const form = reactive(blankForm())

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .split('')
    .map((char) => TRANSLIT[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)

function openCreate(parentId = '') {
  editing.value = null
  Object.assign(form, blankForm())
  form.parentId = parentId
  formError.value = ''
  editorOpen.value = true
}

function openEdit(category: Category) {
  editing.value = category
  Object.assign(form, {
    name: category.name,
    slug: category.slug,
    parentId: category.parentId ?? '',
    description: category.description ?? '',
    seoTitle: category.seoTitle ?? '',
    seoDescription: category.seoDescription ?? '',
  })
  formError.value = ''
  editorOpen.value = true
}

watch(() => form.name, (name) => {
  if (!editing.value) form.slug = slugify(name)
})

async function save() {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = 'Укажите название'
    return
  }
  if (!form.slug.trim()) {
    formError.value = 'Укажите slug'
    return
  }
  if (editing.value && form.parentId === editing.value.id) {
    formError.value = 'Категория не может быть родителем самой себе'
    return
  }

  const body = {
    name: form.name.trim(),
    slug: form.slug.trim(),
    parentId: form.parentId || undefined,
    description: form.description.trim() || undefined,
    seoTitle: form.seoTitle.trim() || form.name.trim(),
    seoDescription: form.seoDescription.trim() || form.name.trim(),
  }

  saving.value = true
  try {
    if (editing.value) {
      await adminFetch(`/categories/${editing.value.id}`, { method: 'PATCH', body })
      toast.success('Категория сохранена')
    } else {
      await adminFetch('/categories', { method: 'POST', body })
      toast.success('Категория создана')
    }
    editorOpen.value = false
    await load()
  } catch (error) {
    formError.value = errorMessage(error, 'Не удалось сохранить категорию')
  } finally {
    saving.value = false
  }
}

/* ---- Merge & delete ---------------------------------------------------- */
const merging = ref<Category | null>(null)
const mergeTarget = ref('')
const mergeBusy = ref(false)

async function confirmMerge() {
  if (!merging.value || !mergeTarget.value) return
  mergeBusy.value = true
  try {
    await adminFetch(`/categories/${merging.value.id}/merge`, {
      method: 'POST',
      body: { targetCategoryId: mergeTarget.value },
    })
    toast.success('Категории объединены')
    merging.value = null
    mergeTarget.value = ''
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось объединить категории'))
  } finally {
    mergeBusy.value = false
  }
}

const deleting = ref<Category | null>(null)
const deletingBusy = ref(false)

async function confirmDelete() {
  if (!deleting.value) return
  deletingBusy.value = true
  try {
    await adminFetch(`/categories/${deleting.value.id}`, { method: 'DELETE' })
    toast.success('Категория удалена')
    deleting.value = null
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось удалить категорию'))
  } finally {
    deletingBusy.value = false
  }
}

const categoryOptions = computed(() =>
  categories.value
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map((c) => ({ value: c.id, label: `${'— '.repeat(c.level)}${c.name}` }))
)

const mergeOptions = computed(() =>
  categoryOptions.value.filter((option) => option.value !== merging.value?.id)
)
</script>

<template>
  <div class="admin-categories">
    <header class="head">
      <div>
        <h1>Категории</h1>
        <p>{{ categories.length }} категорий · дерево строится по родителям</p>
      </div>
      <div class="head-actions">
        <UiInput v-model="search" placeholder="Найти категорию" size="sm" class="search" />
        <UiButton @click="openCreate()">Добавить</UiButton>
      </div>
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div v-if="loading" class="list">
      <UiSkeleton :lines="8" height="20px" />
    </div>

    <UiEmpty
      v-else-if="!visibleRows.length"
      icon="box"
      :title="search ? 'Ничего не найдено' : 'Категорий пока нет'"
      description="Категории обычно создаются парсерами из хлебных крошек поставщиков."
    >
      <UiButton @click="openCreate()">Добавить категорию</UiButton>
    </UiEmpty>

    <ul v-else class="tree">
      <li
        v-for="row in visibleRows"
        :key="row.id"
        class="tree-row"
        :style="{ paddingLeft: `${row.depth * 24 + 12}px` }"
      >
        <button
          v-if="hasChildren(row.id)"
          type="button"
          class="toggle"
          :aria-expanded="!collapsed.has(row.id)"
          :aria-label="collapsed.has(row.id) ? 'Развернуть' : 'Свернуть'"
          @click="toggleCollapse(row.id)"
        >
          <svg viewBox="0 0 20 20" :class="{ 'is-collapsed': collapsed.has(row.id) }" aria-hidden="true">
            <path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <span v-else class="toggle-spacer" />

        <div class="row-main">
          <button type="button" class="row-name" @click="openEdit(row)">{{ row.name }}</button>
          <code class="row-slug">/{{ row.slug }}</code>
        </div>

        <span v-if="row._count" class="row-count">{{ row._count.products }} тов.</span>

        <div class="row-actions">
          <UiButton variant="ghost" size="sm" @click="openCreate(row.id)">+ Подкатегория</UiButton>
          <UiButton variant="ghost" size="sm" @click="openEdit(row)">Изменить</UiButton>
          <UiButton variant="ghost" size="sm" @click="merging = row">Объединить</UiButton>
          <UiButton variant="ghost" size="sm" @click="deleting = row">✕</UiButton>
        </div>
      </li>
    </ul>

    <!-- Editor -->
    <UiModal
      v-model:open="editorOpen"
      :title="editing ? 'Редактирование категории' : 'Новая категория'"
      size="md"
    >
      <UiAlert v-if="formError" tone="danger" class="form-error">{{ formError }}</UiAlert>

      <div class="form">
        <UiField label="Название" required for="c-name">
          <UiInput id="c-name" v-model="form.name" />
        </UiField>

        <UiField
          label="Slug"
          required
          :hint="editing ? 'Изменение сломает существующие ссылки на категорию' : undefined"
          for="c-slug"
        >
          <UiInput id="c-slug" v-model="form.slug" />
        </UiField>

        <UiField label="Родительская категория" for="c-parent">
          <UiSelect
            id="c-parent"
            v-model="form.parentId"
            :options="[
              { value: '', label: 'Корневая категория' },
              ...categoryOptions.filter((o) => o.value !== editing?.id)
            ]"
          />
        </UiField>

        <UiField label="Описание" for="c-desc">
          <UiTextarea id="c-desc" v-model="form.description" :rows="3" />
        </UiField>

        <UiField label="SEO title" hint="Пусто — берётся название" for="c-seo-title">
          <UiInput id="c-seo-title" v-model="form.seoTitle" />
        </UiField>

        <UiField label="SEO description" for="c-seo-desc">
          <UiTextarea id="c-seo-desc" v-model="form.seoDescription" :rows="2" />
        </UiField>
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="editorOpen = false">Отмена</UiButton>
        <UiButton :loading="saving" @click="save">
          {{ editing ? 'Сохранить' : 'Создать' }}
        </UiButton>
      </template>
    </UiModal>

    <!-- Merge -->
    <UiModal
      :open="Boolean(merging)"
      title="Объединить категории"
      size="md"
      @update:open="merging = null"
    >
      <p class="confirm-text">
        Все товары и подкатегории из «{{ merging?.name }}» переедут в выбранную категорию,
        а «{{ merging?.name }}» будет удалена.
      </p>
      <UiField label="Целевая категория" required for="c-merge">
        <UiSelect
          id="c-merge"
          v-model="mergeTarget"
          placeholder="Выберите категорию"
          :options="mergeOptions"
        />
      </UiField>

      <template #footer>
        <UiButton variant="ghost" @click="merging = null">Отмена</UiButton>
        <UiButton :loading="mergeBusy" :disabled="!mergeTarget" @click="confirmMerge">
          Объединить
        </UiButton>
      </template>
    </UiModal>

    <!-- Delete -->
    <UiModal
      :open="Boolean(deleting)"
      title="Удалить категорию?"
      size="sm"
      @update:open="deleting = null"
    >
      <p class="confirm-text">
        «{{ deleting?.name }}» будет удалена. Если в ней есть товары или подкатегории,
        API отклонит удаление — сначала объедините её с другой категорией.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleting = null">Отмена</UiButton>
        <UiButton variant="danger" :loading="deletingBusy" @click="confirmDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.admin-categories {
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

.head p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.search {
  width: min(260px, 100%);
}

.tree,
.list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  list-style: none;
}

.list {
  padding: var(--space-4);
}

.tree-row {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-4) var(--space-2) 0;
  border-bottom: 1px solid var(--border-subtle);
  gap: var(--space-2);
}

.tree-row:last-child {
  border-bottom: 0;
}

.tree-row:hover {
  background: var(--surface-hover);
}

.toggle,
.toggle-spacer {
  display: grid;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  place-items: center;
}

.toggle svg {
  width: 16px;
  height: 16px;
  transition: transform var(--duration-fast) var(--ease-out);
}

.toggle svg.is-collapsed {
  transform: rotate(-90deg);
}

.row-main {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: baseline;
  gap: var(--space-3);
}

.row-name {
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 600;
}

.row-name:hover {
  color: var(--text-link);
}

.row-slug {
  color: var(--text-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.row-count {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.row-actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.tree-row:hover .row-actions,
.row-actions:focus-within {
  opacity: 1;
}

@media (hover: none) {
  .row-actions {
    opacity: 1;
  }
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-error {
  margin-bottom: var(--space-4);
}

.confirm-text {
  margin-bottom: var(--space-4);
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .row-actions {
    opacity: 1;
  }

  .tree-row {
    flex-wrap: wrap;
  }
}
</style>
