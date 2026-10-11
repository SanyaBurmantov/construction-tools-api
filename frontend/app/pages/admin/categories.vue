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
  image: string | null
  seoTitle: string
  seoDescription: string
  /** 0 = never placed by hand; the storefront then sorts by product count. */
  sortOrder: number
  isVisible: boolean
  isFeatured: boolean
  _count?: { products: number, children: number }
}

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()

const categories = ref<Category[]>([])
const loading = ref(false)
const loadError = ref('')
const search = ref('')

/**
 * Curation views. The tree is ~1500 rows built by the parsers, so the useful
 * questions are not "find this name" but "what is switched off", "what is
 * pinned" and "what is an empty shell" — a supplier branch whose products were
 * all delisted. Those are invisible in a flat alphabetical tree.
 */
const VIEWS = [
  { value: 'all', label: 'Все категории' },
  { value: 'visible', label: 'Только видимые' },
  { value: 'hidden', label: 'Скрытые' },
  { value: 'featured', label: 'На главной' },
  { value: 'empty', label: 'Пустые (0 товаров)' },
]
const view = ref('all')

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

  /**
   * Same order the storefront uses: curated positions first, then biggest,
   * then alphabetical. Sorting this page by name instead would make the
   * reorder buttons move rows to places the admin cannot see.
   */
  const rank = (node: TreeNode) => (node.sortOrder > 0 ? node.sortOrder : Number.MAX_SAFE_INTEGER)
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort(
      (a, b) =>
        rank(a) - rank(b)
        || (b._count?.products ?? 0) - (a._count?.products ?? 0)
        || a.name.localeCompare(b.name, 'ru')
    )
    nodes.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
})

/** Siblings of a category, in the order this page shows them. */
function siblingsOf(row: Category): TreeNode[] {
  if (!row.parentId) return tree.value
  const find = (nodes: TreeNode[]): TreeNode[] | null => {
    for (const node of nodes) {
      if (node.id === row.parentId) return node.children
      const found = find(node.children)
      if (found) return found
    }
    return null
  }
  return find(tree.value) ?? []
}

/**
 * Does this row match the view? A branch is still shown when a descendant
 * matches, so a hidden subcategory can be found through its parents.
 */
function matchesView(node: Category) {
  if (view.value === 'hidden') return !node.isVisible
  if (view.value === 'visible') return node.isVisible
  if (view.value === 'featured') return node.isFeatured
  if (view.value === 'empty') return !node._count?.products && !node._count?.children
  return true
}

/** Flattened tree with depth, filtered by the search box and the view. */
const rows = computed(() => {
  const query = search.value.trim().toLowerCase()
  const result: Array<TreeNode & { depth: number }> = []

  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      const matchesQuery = !query || node.name.toLowerCase().includes(query)
        || node.slug.toLowerCase().includes(query)
      const matches = matchesQuery && matchesView(node)
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

const hiddenCount = computed(() => categories.value.filter((row) => !row.isVisible).length)
const featuredCount = computed(() => categories.value.filter((row) => row.isFeatured).length)

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
  image: '',
  seoTitle: '',
  seoDescription: '',
  sortOrder: '',
  isVisible: true,
  isFeatured: false,
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
    image: category.image ?? '',
    seoTitle: category.seoTitle ?? '',
    seoDescription: category.seoDescription ?? '',
    sortOrder: category.sortOrder ? String(category.sortOrder) : '',
    isVisible: category.isVisible,
    isFeatured: category.isFeatured,
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
    // `null`, not `undefined`: an omitted field leaves the old URL in place,
    // so emptying the input could never remove a picture.
    image: form.image.trim() || null,
    seoTitle: form.seoTitle.trim() || form.name.trim(),
    seoDescription: form.seoDescription.trim() || form.name.trim(),
    sortOrder: form.sortOrder ? Number(form.sortOrder) : 0,
    isVisible: form.isVisible,
    isFeatured: form.isFeatured,
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

/* ---- Display settings -------------------------------------------------- */
/**
 * Visibility, pinning and order are one PATCH each, applied straight from the
 * row: these are the settings an admin changes while *looking* at the tree,
 * and routing them through the editor modal would mean opening and closing it
 * once per category.
 *
 * The row is updated in place on success rather than reloading the whole list,
 * so the tree keeps its scroll position and collapsed state.
 */
const busyRows = ref<Set<string>>(new Set())

function setBusy(id: string, busy: boolean) {
  const next = new Set(busyRows.value)
  if (busy) next.add(id)
  else next.delete(id)
  busyRows.value = next
}

async function patchDisplay(row: Category, body: Record<string, unknown>, done: string) {
  setBusy(row.id, true)
  try {
    const updated = await adminFetch<Category>(`/categories/${row.id}`, {
      method: 'PATCH',
      body,
    })
    const index = categories.value.findIndex((item) => item.id === row.id)
    if (index >= 0) {
      categories.value[index] = { ...categories.value[index]!, ...updated }
    }
    toast.success(done)
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось сохранить настройку'))
  } finally {
    setBusy(row.id, false)
  }
}

function toggleVisible(row: Category) {
  return patchDisplay(
    row,
    { isVisible: !row.isVisible },
    row.isVisible ? `«${row.name}» скрыта из каталога` : `«${row.name}» снова в каталоге`
  )
}

function toggleFeatured(row: Category) {
  return patchDisplay(
    row,
    { isFeatured: !row.isFeatured },
    row.isFeatured ? `«${row.name}» убрана с главной` : `«${row.name}» закреплена на главной`
  )
}

/**
 * Moving a row renumbers the whole row of siblings from 1 in one request, so
 * two categories can never end up claiming the same position — which is what
 * happens if each row's `sortOrder` is patched on its own and the second call
 * fails.
 */
async function move(row: Category, direction: -1 | 1) {
  const siblings = siblingsOf(row)
  const from = siblings.findIndex((item) => item.id === row.id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= siblings.length) return

  const ids = siblings.map((item) => item.id)
  const [moved] = ids.splice(from, 1)
  ids.splice(to, 0, moved!)

  setBusy(row.id, true)
  try {
    await adminFetch('/categories/order', { method: 'PATCH', body: { ids } })
    // Positions are 1-based on the server; mirror that locally.
    for (const [index, id] of ids.entries()) {
      const target = categories.value.findIndex((item) => item.id === id)
      if (target >= 0) categories.value[target] = { ...categories.value[target]!, sortOrder: index + 1 }
    }
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось изменить порядок'))
  } finally {
    setBusy(row.id, false)
  }
}

function canMove(row: Category, direction: -1 | 1) {
  const siblings = siblingsOf(row)
  const index = siblings.findIndex((item) => item.id === row.id)
  return index >= 0 && index + direction >= 0 && index + direction < siblings.length
}

/* ---- Card artwork ------------------------------------------------------
 * A category tile falls back to the first letter of its name on a grey plate;
 * a picture replaces it. The URL is in the editor modal too, but artwork is
 * chosen while *looking* at the tree — so it gets the same treatment as
 * visibility and order: a thumbnail on every row that opens one small dialog,
 * with the real storefront tile as the preview.
 */
const imaging = ref<Category | null>(null)
const imageDraft = ref('')
const imageError = ref('')
const imageBusy = computed(() => Boolean(imaging.value && busyRows.value.has(imaging.value.id)))

function initialOf(name: string) {
  return name.trim().charAt(0).toUpperCase()
}

function openImage(row: Category) {
  imaging.value = row
  imageDraft.value = row.image ?? ''
  imageError.value = ''
}

/** Everything the tile can actually load: an absolute URL or a site path. */
function imageUrlLooksValid(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith('/')
}

async function saveImage(value: string | null) {
  const row = imaging.value
  if (!row) return
  if (value && !imageUrlLooksValid(value)) {
    imageError.value = 'Ссылка должна начинаться с https:// или с /'
    return
  }
  imageError.value = ''
  await patchDisplay(row, { image: value }, value ? 'Картинка сохранена' : 'Картинка убрана')
  // `patchDisplay` reports its own failure as a toast; close either way, the
  // row below shows what actually got saved.
  imaging.value = null
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
        <p>
          {{ categories.length }} категорий · {{ hiddenCount }} скрыто ·
          {{ featuredCount }} на главной
        </p>
      </div>
      <div class="head-actions">
        <UiSelect v-model="view" size="sm" class="view" :options="VIEWS" />
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
      :title="search || view !== 'all' ? 'Ничего не найдено' : 'Категорий пока нет'"
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

        <!-- Artwork doubles as its own control: what the tile shows today,
             click to change it. -->
        <button
          type="button"
          class="row-thumb"
          :class="{ 'has-image': row.image }"
          :title="row.image ? 'Изменить картинку' : 'Добавить картинку'"
          :disabled="busyRows.has(row.id)"
          @click="openImage(row)"
        >
          <img v-if="row.image" :src="row.image" alt="" loading="lazy">
          <span v-else class="row-thumb-plate" aria-hidden="true">{{ initialOf(row.name) }}</span>
          <span class="sr-only">Картинка категории «{{ row.name }}»</span>
        </button>

        <div class="row-main">
          <button type="button" class="row-name" @click="openEdit(row)">{{ row.name }}</button>
          <code class="row-slug">/{{ row.slug }}</code>
          <UiBadge v-if="!row.isVisible" tone="neutral" size="sm">скрыта</UiBadge>
          <UiBadge v-if="row.isFeatured" tone="brand" size="sm">на главной</UiBadge>
          <UiBadge v-if="row.isVisible && !row._count?.products && !row._count?.children" tone="warning" size="sm">
            пустая
          </UiBadge>
        </div>

        <span v-if="row._count" class="row-count">{{ row._count.products }} тов.</span>

        <!-- Order, visibility and pinning sit on the row: they are changed
             while looking at the tree, not inside the editor. -->
        <div class="row-display">
          <button
            type="button"
            class="icon-btn"
            :disabled="!canMove(row, -1) || busyRows.has(row.id)"
            aria-label="Выше"
            title="Выше"
            @click="move(row, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            class="icon-btn"
            :disabled="!canMove(row, 1) || busyRows.has(row.id)"
            aria-label="Ниже"
            title="Ниже"
            @click="move(row, 1)"
          >
            ↓
          </button>
          <button
            type="button"
            class="icon-btn"
            :class="{ 'is-on': row.isFeatured }"
            :disabled="busyRows.has(row.id)"
            :aria-pressed="row.isFeatured"
            :aria-label="`Показывать «${row.name}» на главной`"
            title="На главной"
            @click="toggleFeatured(row)"
          >
            ★
          </button>
          <button
            type="button"
            class="icon-btn"
            :class="{ 'is-off': !row.isVisible }"
            :disabled="busyRows.has(row.id)"
            :aria-pressed="!row.isVisible"
            :aria-label="`Скрыть «${row.name}» из каталога`"
            :title="row.isVisible ? 'Скрыть из каталога' : 'Вернуть в каталог'"
            @click="toggleVisible(row)"
          >
            {{ row.isVisible ? '👁' : '🚫' }}
          </button>
        </div>

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

        <UiField
          label="Картинка категории"
          hint="Ссылка на изображение. Без неё плитка берёт фото самого дорогого товара категории, а если фото нет ни у кого — букву названия"
          for="c-image"
        >
          <UiInput id="c-image" v-model="form.image" placeholder="https://…" />
        </UiField>

        <div v-if="form.image" class="form-preview">
          <span class="form-preview-label">Так выглядит плитка в каталоге</span>
          <div class="tile-preview">
            <UiCategoryCard :name="form.name || 'Категория'" to="#" :image="form.image" :count="0" />
          </div>
        </div>

        <UiField
          label="Позиция в списке"
          hint="Пусто или 0 — сортировать по числу товаров"
          for="c-order"
        >
          <UiInput id="c-order" v-model="form.sortOrder" type="number" min="0" />
        </UiField>

        <div class="form-switches">
          <UiCheckbox v-model="form.isVisible" label="Показывать в каталоге" />
          <UiCheckbox v-model="form.isFeatured" label="Закрепить на главной" />
        </div>

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

    <!-- Artwork -->
    <UiModal
      :open="Boolean(imaging)"
      :title="`Картинка: ${imaging?.name ?? ''}`"
      size="sm"
      @update:open="imaging = null"
    >
      <div class="image-dialog">
        <UiAlert v-if="imageError" tone="danger">{{ imageError }}</UiAlert>

        <!-- The real storefront tile, so there is no guessing how the picture
             will crop — and it shows the letter plate when the field is empty,
             which is exactly what the catalogue will do. -->
        <div class="tile-preview">
          <UiCategoryCard
            :name="imaging?.name ?? ''"
            to="#"
            :image="imageDraft.trim() || null"
            :count="imaging?._count?.products ?? 0"
          />
        </div>

        <UiField
          label="Ссылка на картинку"
          hint="https://… или путь на нашем сайте. Пусто — фото самого дорогого товара категории"
          for="c-thumb"
        >
          <UiInput
            id="c-thumb"
            v-model="imageDraft"
            placeholder="https://…/category.jpg"
            @keyup.enter="saveImage(imageDraft.trim() || null)"
          />
        </UiField>
      </div>

      <template #footer>
        <UiButton
          v-if="imaging?.image"
          variant="ghost"
          :disabled="imageBusy"
          @click="saveImage(null)"
        >
          Убрать картинку
        </UiButton>
        <UiButton variant="ghost" @click="imaging = null">Отмена</UiButton>
        <UiButton :loading="imageBusy" @click="saveImage(imageDraft.trim() || null)">
          Сохранить
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

.view {
  width: min(200px, 100%);
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

/* ---- Artwork ---- */
.row-thumb {
  display: grid;
  overflow: hidden;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  place-items: center;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.row-thumb:hover:not(:disabled),
.row-thumb:focus-visible {
  border-color: var(--brand);
  box-shadow: var(--shadow-xs);
}

.row-thumb:disabled {
  opacity: 0.5;
}

.row-thumb.has-image {
  background: var(--surface-card);
}

.row-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: var(--image-blend);
}

.row-thumb-plate {
  color: var(--text-subtle);
  font-weight: 800;
}

/* The preview is the storefront tile itself — shown, not clickable. */
.tile-preview {
  width: 220px;
  max-width: 100%;
  margin-inline: auto;
  pointer-events: none;
}

.image-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-preview-label {
  color: var(--text-muted);
  font-size: var(--text-xs);
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

.row-display {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
}

.icon-btn {
  display: grid;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: 1;
  place-items: center;
}

.icon-btn:hover:not(:disabled) {
  border-color: var(--border-subtle);
  background: var(--surface-active);
  color: var(--text-strong);
}

.icon-btn:disabled {
  cursor: default;
  opacity: 0.3;
}

.icon-btn.is-on {
  color: var(--warning);
}

.icon-btn.is-off {
  color: var(--danger);
}

.form-switches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}

/* A hidden category stays in the tree but should read as switched off. */
.tree-row:has(.row-display .is-off) .row-name {
  color: var(--text-muted);
  text-decoration: line-through;
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
