<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type AdminProduct = {
  id: string
  slug: string
  name: string
  sku: string | null
  model: string | null
  priceValue: number | null
  oldPrice: number | null
  priceCurrency: string | null
  stockStatus: string | null
  stockQuantity: number | null
  status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED'
  descriptionShort: string | null
  descriptionFull: string | null
  seoTitle: string | null
  seoDescription: string | null
  categoryId: string
  brandId: string | null
  brand?: { id: string, name: string } | null
  category?: { id: string, name: string } | null
  images?: Array<{ id: string, url: string, alt?: string | null }>
  productSpecs?: Array<{ name: string, value: string }>
  ratingAvg?: number | null
  ratingCount?: number
}

type ListResponse = {
  data: AdminProduct[]
  pagination: { page: number, limit: number, total: number, pages: number }
}

type Category = { id: string, name: string, level: number }
type Brand = { id: string, name: string }

const { adminFetch, errorMessage } = useAdminApi()
const toast = useToast()
const { formatPrice } = useFormatPrice()

/* ---- List -------------------------------------------------------------- */
const products = ref<AdminProduct[]>([])
const pagination = ref({ page: 1, limit: 20, total: 0, pages: 0 })
const loading = ref(false)
const loadError = ref('')

const filters = reactive({
  search: '',
  status: '' as '' | AdminProduct['status'],
  categoryId: '',
  brandId: '',
  sortBy: 'updated' as 'name' | 'priceValue' | 'created' | 'updated',
  sortOrder: 'desc' as 'asc' | 'desc',
})
const page = ref(1)

const categories = ref<Category[]>([])
const brands = ref<Brand[]>([])

async function loadReferences() {
  const [cats, brs] = await Promise.all([
    adminFetch<Category[]>('/categories').catch(() => []),
    adminFetch<Brand[]>('/brands').catch(() => []),
  ])
  categories.value = cats
  brands.value = brs
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await adminFetch<ListResponse>('/products', {
      params: {
        page: page.value,
        limit: 20,
        ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.brandId ? { brandId: filters.brandId } : {}),
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
      },
    })
    products.value = response.data
    pagination.value = response.pagination
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить товары')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadReferences()
  await load()
})

// Debounce the search box; every other filter applies immediately.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(() => filters.search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    void load()
  }, 350)
})
watch(
  () => [filters.status, filters.categoryId, filters.brandId, filters.sortBy, filters.sortOrder],
  () => {
    page.value = 1
    void load()
  }
)
watch(page, () => void load())

/* ---- Editor ------------------------------------------------------------ */
const editorOpen = ref(false)
const saving = ref(false)
const editing = ref<AdminProduct | null>(null)
const formError = ref('')

const blankForm = () => ({
  name: '',
  slug: '',
  categoryId: '',
  brandId: '',
  sku: '',
  model: '',
  priceValue: null as number | null,
  oldPrice: null as number | null,
  priceCurrency: 'BYN',
  stockStatus: 'in_stock',
  stockQuantity: null as number | null,
  status: 'PUBLISHED' as AdminProduct['status'],
  descriptionShort: '',
  descriptionFull: '',
  seoTitle: '',
  seoDescription: '',
})

const form = reactive(blankForm())
const editorTab = ref<'main' | 'price' | 'seo'>('main')

/** Cyrillic-aware slug, mirroring the backend's generate-slug util. */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .split('')
    .map((char) => TRANSLIT[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
}

function openCreate() {
  editing.value = null
  Object.assign(form, blankForm())
  form.categoryId = categories.value[0]?.id ?? ''
  formError.value = ''
  editorTab.value = 'main'
  editorOpen.value = true
}

function openEdit(product: AdminProduct) {
  editing.value = product
  Object.assign(form, {
    ...blankForm(),
    name: product.name,
    slug: product.slug,
    categoryId: product.categoryId,
    brandId: product.brandId ?? '',
    sku: product.sku ?? '',
    model: product.model ?? '',
    priceValue: product.priceValue,
    oldPrice: product.oldPrice,
    priceCurrency: product.priceCurrency ?? 'BYN',
    stockStatus: product.stockStatus ?? 'in_stock',
    stockQuantity: product.stockQuantity,
    status: product.status,
    descriptionShort: product.descriptionShort ?? '',
    descriptionFull: product.descriptionFull ?? '',
    seoTitle: product.seoTitle ?? '',
    seoDescription: product.seoDescription ?? '',
  })
  formError.value = ''
  editorTab.value = 'main'
  editorOpen.value = true
}

// Auto-fill the slug from the name, but only while creating — changing a live
// product's slug would break its URL.
watch(() => form.name, (name) => {
  if (!editing.value) form.slug = slugify(name)
})

const discountPercent = computed(() => {
  if (!form.oldPrice || !form.priceValue || form.oldPrice <= form.priceValue) return 0
  return Math.round((1 - form.priceValue / form.oldPrice) * 100)
})

function toNumber(value: number | null) {
  return value === null || Number.isNaN(value) ? undefined : Number(value)
}

async function save() {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = 'Укажите название'
    editorTab.value = 'main'
    return
  }
  if (!form.slug.trim()) {
    formError.value = 'Укажите slug'
    editorTab.value = 'main'
    return
  }
  if (!form.categoryId) {
    formError.value = 'Выберите категорию'
    editorTab.value = 'main'
    return
  }
  if (form.oldPrice && form.priceValue && form.oldPrice <= form.priceValue) {
    formError.value = 'Старая цена должна быть выше текущей — иначе скидка не покажется'
    editorTab.value = 'price'
    return
  }

  const body = {
    name: form.name.trim(),
    slug: form.slug.trim(),
    categoryId: form.categoryId,
    brandId: form.brandId || undefined,
    sku: form.sku.trim() || undefined,
    model: form.model.trim() || undefined,
    priceValue: toNumber(form.priceValue),
    oldPrice: toNumber(form.oldPrice),
    priceCurrency: form.priceCurrency || 'BYN',
    stockStatus: form.stockStatus,
    stockQuantity: toNumber(form.stockQuantity),
    status: form.status,
    descriptionShort: form.descriptionShort.trim() || undefined,
    descriptionFull: form.descriptionFull.trim() || undefined,
    seoTitle: form.seoTitle.trim() || undefined,
    seoDescription: form.seoDescription.trim() || undefined,
  }

  saving.value = true
  try {
    if (editing.value) {
      await adminFetch(`/products/${editing.value.id}`, { method: 'PATCH', body })
      toast.success('Товар сохранён')
    } else {
      await adminFetch('/products', { method: 'POST', body })
      toast.success('Товар создан')
    }
    editorOpen.value = false
    await load()
  } catch (error) {
    formError.value = errorMessage(error, 'Не удалось сохранить товар')
  } finally {
    saving.value = false
  }
}

/* ---- Delete ------------------------------------------------------------ */
const deleting = ref<AdminProduct | null>(null)
const deletingBusy = ref(false)

async function confirmDelete() {
  if (!deleting.value) return
  deletingBusy.value = true
  try {
    await adminFetch(`/products/${deleting.value.id}`, { method: 'DELETE' })
    toast.success('Товар удалён')
    deleting.value = null
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось удалить товар'))
  } finally {
    deletingBusy.value = false
  }
}

/* ---- Bulk status ------------------------------------------------------- */
const selected = ref<Set<string>>(new Set())
const bulkBusy = ref(false)

const allSelected = computed(
  () => products.value.length > 0 && selected.value.size === products.value.length
)

function toggleAll() {
  selected.value = allSelected.value
    ? new Set()
    : new Set(products.value.map((p) => p.id))
}

function toggleOne(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

async function bulkStatus(status: AdminProduct['status']) {
  const ids = [...selected.value]
  if (!ids.length) return
  bulkBusy.value = true
  try {
    // No bulk endpoint on the API — sequential PATCHes keep it simple and
    // the selection is capped at one page (20 items).
    for (const id of ids) {
      await adminFetch(`/products/${id}`, { method: 'PATCH', body: { status } })
    }
    toast.success(`Обновлено товаров: ${ids.length}`)
    selected.value = new Set()
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось обновить статус'))
  } finally {
    bulkBusy.value = false
  }
}

/* ---- Display helpers --------------------------------------------------- */
const STATUS_TONES: Record<AdminProduct['status'], 'success' | 'neutral' | 'warning' | 'danger'> = {
  PUBLISHED: 'success',
  DRAFT: 'neutral',
  HIDDEN: 'warning',
  ARCHIVED: 'danger',
}
const STATUS_LABELS: Record<AdminProduct['status'], string> = {
  PUBLISHED: 'Опубликован',
  DRAFT: 'Черновик',
  HIDDEN: 'Скрыт',
  ARCHIVED: 'Архив',
}

const categoryOptions = computed(() =>
  categories.value.map((c) => ({
    value: c.id,
    // Indent nested categories so the tree is readable in a flat <select>.
    label: `${'— '.repeat(c.level)}${c.name}`,
  }))
)
const brandOptions = computed(() => brands.value.map((b) => ({ value: b.id, label: b.name })))
</script>

<template>
  <div class="admin-products">
    <header class="head">
      <div>
        <h1>Товары</h1>
        <p>{{ pagination.total }} товаров в каталоге</p>
      </div>
      <UiButton @click="openCreate">Добавить товар</UiButton>
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div class="filters">
      <UiInput v-model="filters.search" placeholder="Название, артикул или slug" size="sm">
        <template #leading>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm7.5 14.5L16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </template>
      </UiInput>

      <UiSelect
        v-model="filters.status"
        size="sm"
        :options="[
          { value: '', label: 'Все статусы' },
          { value: 'PUBLISHED', label: 'Опубликованные' },
          { value: 'DRAFT', label: 'Черновики' },
          { value: 'HIDDEN', label: 'Скрытые' },
          { value: 'ARCHIVED', label: 'Архив' }
        ]"
      />

      <UiSelect
        v-model="filters.categoryId"
        size="sm"
        :options="[{ value: '', label: 'Все категории' }, ...categoryOptions]"
      />

      <UiSelect
        v-model="filters.brandId"
        size="sm"
        :options="[{ value: '', label: 'Все бренды' }, ...brandOptions]"
      />

      <UiSelect
        v-model="filters.sortBy"
        size="sm"
        :options="[
          { value: 'updated', label: 'По дате изменения' },
          { value: 'created', label: 'По дате создания' },
          { value: 'name', label: 'По названию' },
          { value: 'priceValue', label: 'По цене' }
        ]"
      />
    </div>

    <Transition name="fade">
      <div v-if="selected.size" class="bulk">
        <span>Выбрано: {{ selected.size }}</span>
        <UiButton size="sm" variant="secondary" :loading="bulkBusy" @click="bulkStatus('PUBLISHED')">
          Опубликовать
        </UiButton>
        <UiButton size="sm" variant="secondary" :loading="bulkBusy" @click="bulkStatus('HIDDEN')">
          Скрыть
        </UiButton>
        <UiButton size="sm" variant="ghost" @click="selected = new Set()">Снять выделение</UiButton>
      </div>
    </Transition>

    <div class="table-wrap scroll-x">
      <table class="products-table">
        <thead>
          <tr>
            <th class="check-col">
              <UiCheckbox :model-value="allSelected" @update:model-value="toggleAll" />
            </th>
            <th>Товар</th>
            <th>Категория</th>
            <th class="num">Цена</th>
            <th>Статус</th>
            <th class="actions-col" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6"><UiSkeleton :lines="5" height="18px" /></td>
          </tr>
          <tr v-else-if="!products.length">
            <td colspan="6">
              <UiEmpty
                icon="box"
                title="Товары не найдены"
                description="Измените фильтры или добавьте первый товар."
              />
            </td>
          </tr>
          <tr v-for="product in products" v-else :key="product.id">
            <td class="check-col">
              <UiCheckbox
                :model-value="selected.has(product.id)"
                @update:model-value="toggleOne(product.id)"
              />
            </td>
            <td>
              <div class="product-cell">
                <div class="thumb">
                  <img
                    v-if="product.images?.length"
                    :src="product.images[0]!.url"
                    :alt="product.name"
                    loading="lazy"
                  >
                  <span v-else class="thumb-empty" aria-hidden="true" />
                </div>
                <div class="product-meta">
                  <button type="button" class="product-name" @click="openEdit(product)">
                    {{ product.name }}
                  </button>
                  <span class="product-sub">
                    <span v-if="product.brand?.name">{{ product.brand.name }}</span>
                    <span v-if="product.sku">Арт. {{ product.sku }}</span>
                    <span v-if="product.ratingCount">★ {{ product.ratingAvg?.toFixed(1) }}</span>
                  </span>
                </div>
              </div>
            </td>
            <td class="muted">{{ product.category?.name || '—' }}</td>
            <td class="num">
              <div class="price-cell">
                <strong>{{ formatPrice(product.priceValue, product.priceCurrency) }}</strong>
                <s v-if="product.oldPrice && product.priceValue && product.oldPrice > product.priceValue">
                  {{ formatPrice(product.oldPrice, product.priceCurrency) }}
                </s>
              </div>
            </td>
            <td>
              <UiBadge :tone="STATUS_TONES[product.status]" size="sm">
                {{ STATUS_LABELS[product.status] }}
              </UiBadge>
            </td>
            <td class="actions-col">
              <div class="row-actions">
                <UiButton variant="ghost" size="sm" @click="openEdit(product)">Изменить</UiButton>
                <UiButton
                  variant="ghost"
                  size="sm"
                  :href="`/product/${product.slug}`"
                  target="_blank"
                >
                  ↗
                </UiButton>
                <UiButton variant="ghost" size="sm" @click="deleting = product">✕</UiButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UiPagination
      :page="pagination.page"
      :pages="pagination.pages"
      :total="pagination.total"
      @change="page = $event"
    />

    <!-- Editor -->
    <UiModal
      v-model:open="editorOpen"
      :title="editing ? 'Редактирование товара' : 'Новый товар'"
      size="lg"
    >
      <UiTabs
        v-model="editorTab"
        :tabs="[
          { value: 'main', label: 'Основное' },
          { value: 'price', label: 'Цена и наличие' },
          { value: 'seo', label: 'SEO и описание' }
        ]"
      />

      <UiAlert v-if="formError" tone="danger" class="form-error">{{ formError }}</UiAlert>

      <div v-show="editorTab === 'main'" class="form">
        <UiField label="Название" required for="p-name">
          <UiInput id="p-name" v-model="form.name" placeholder="Дрель ударная 750 Вт" />
        </UiField>

        <UiField
          label="Slug"
          required
          :hint="editing ? 'Изменение slug сломает существующие ссылки на товар' : 'Формируется из названия'"
          for="p-slug"
        >
          <UiInput id="p-slug" v-model="form.slug" />
        </UiField>

        <div class="form-row">
          <UiField label="Категория" required for="p-category">
            <UiSelect id="p-category" v-model="form.categoryId" :options="categoryOptions" />
          </UiField>

          <UiField label="Бренд" for="p-brand">
            <UiSelect
              id="p-brand"
              v-model="form.brandId"
              :options="[{ value: '', label: 'Без бренда' }, ...brandOptions]"
            />
          </UiField>
        </div>

        <div class="form-row">
          <UiField label="Артикул" for="p-sku">
            <UiInput id="p-sku" v-model="form.sku" />
          </UiField>
          <UiField label="Модель" for="p-model">
            <UiInput id="p-model" v-model="form.model" />
          </UiField>
        </div>

        <UiField label="Статус" for="p-status">
          <UiSelect
            id="p-status"
            v-model="form.status"
            :options="[
              { value: 'PUBLISHED', label: 'Опубликован' },
              { value: 'DRAFT', label: 'Черновик' },
              { value: 'HIDDEN', label: 'Скрыт' },
              { value: 'ARCHIVED', label: 'Архив' }
            ]"
          />
        </UiField>
      </div>

      <div v-show="editorTab === 'price'" class="form">
        <div class="form-row">
          <UiField label="Цена" for="p-price">
            <UiInput id="p-price" v-model="form.priceValue" type="number" step="0.01" min="0" />
          </UiField>

          <UiField
            label="Старая цена"
            :hint="discountPercent ? `Скидка ${discountPercent}%` : 'Выше текущей — включает бейдж скидки'"
            for="p-old-price"
          >
            <UiInput id="p-old-price" v-model="form.oldPrice" type="number" step="0.01" min="0" />
          </UiField>
        </div>

        <div class="form-row">
          <UiField label="Валюта" for="p-currency">
            <UiSelect
              id="p-currency"
              v-model="form.priceCurrency"
              :options="[
                { value: 'BYN', label: 'BYN' },
                { value: 'RUB', label: 'RUB' },
                { value: 'USD', label: 'USD' },
                { value: 'EUR', label: 'EUR' }
              ]"
            />
          </UiField>

          <UiField label="Наличие" for="p-stock">
            <UiSelect
              id="p-stock"
              v-model="form.stockStatus"
              :options="[
                { value: 'in_stock', label: 'В наличии' },
                { value: 'out_of_stock', label: 'Под заказ' },
                { value: 'unknown', label: 'Уточняйте' }
              ]"
            />
          </UiField>
        </div>

        <UiField label="Остаток, шт." for="p-qty">
          <UiInput id="p-qty" v-model="form.stockQuantity" type="number" min="0" />
        </UiField>
      </div>

      <div v-show="editorTab === 'seo'" class="form">
        <UiField label="Краткое описание" for="p-desc-short">
          <UiTextarea id="p-desc-short" v-model="form.descriptionShort" :rows="3" />
        </UiField>

        <UiField label="Полное описание" for="p-desc-full">
          <UiTextarea id="p-desc-full" v-model="form.descriptionFull" :rows="6" />
        </UiField>

        <UiField label="SEO title" hint="Пусто — берётся название товара" for="p-seo-title">
          <UiInput id="p-seo-title" v-model="form.seoTitle" />
        </UiField>

        <UiField label="SEO description" for="p-seo-desc">
          <UiTextarea id="p-seo-desc" v-model="form.seoDescription" :rows="3" />
        </UiField>
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="editorOpen = false">Отмена</UiButton>
        <UiButton :loading="saving" @click="save">
          {{ editing ? 'Сохранить' : 'Создать' }}
        </UiButton>
      </template>
    </UiModal>

    <!-- Delete confirmation -->
    <UiModal
      :open="Boolean(deleting)"
      title="Удалить товар?"
      size="sm"
      @update:open="deleting = null"
    >
      <p class="confirm-text">
        Товар «{{ deleting?.name }}» будет удалён вместе с изображениями и характеристиками.
        Действие необратимо.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleting = null">Отмена</UiButton>
        <UiButton variant="danger" :loading="deletingBusy" @click="confirmDelete">
          Удалить
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.admin-products {
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

.filters {
  display: grid;
  grid-template-columns: minmax(220px, 2fr) repeat(4, minmax(140px, 1fr));
  gap: var(--space-3);
}

.bulk {
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--brand-soft);
  border-radius: var(--radius-sm);
  background: var(--brand-soft);
  color: var(--brand-soft-text);
  font-size: var(--text-sm);
  font-weight: 600;
  gap: var(--space-3);
}

.table-wrap {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.products-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.products-table th {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}

.products-table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.products-table tbody tr:last-child td {
  border-bottom: 0;
}

.products-table tbody tr:hover td {
  background: var(--surface-hover);
}

.check-col {
  width: 44px;
}

.actions-col {
  width: 1%;
  white-space: nowrap;
}

.num {
  text-align: right;
}

.muted {
  color: var(--text-muted);
}

.product-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.thumb {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xs);
  background: var(--surface-card);
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.thumb-empty {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
}

.product-meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.product-name {
  color: var(--text-strong);
  font-weight: 600;
  text-align: left;
}

.product-name:hover {
  color: var(--text-link);
}

.product-sub {
  display: flex;
  flex-wrap: wrap;
  color: var(--text-subtle);
  font-size: var(--text-xs);
  gap: var(--space-2);
}

.price-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.price-cell strong {
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}

.price-cell s {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.row-actions {
  display: flex;
  gap: var(--space-1);
}

/* ---- Editor ---- */
.form {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-5);
  gap: var(--space-4);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.form-error {
  margin-top: var(--space-4);
}

.confirm-text {
  color: var(--text-muted);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 900px) {
  .filters {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  .filters,
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
