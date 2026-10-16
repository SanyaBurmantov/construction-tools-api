<script setup lang="ts">
import type { Brand, Paginated } from '~/types/api'
import type { CategoryOptionSource } from '~/utils/category-options'
import type { ProductStatus } from '~/utils/product-status'

definePageMeta({ layout: 'admin' })

type AdminProduct = {
  id: string
  slug: string
  name: string
  sku: string | null
  model: string | null
  priceValue: number | null
  oldPrice: number | null
  costPrice: number | null
  pricingMode: 'AUTO' | 'MANUAL'
  priceReviewNeeded?: boolean
  priceCurrency: string | null
  stockStatus: string | null
  stockQuantity: number | null
  status: ProductStatus
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

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()
const { run, busy } = useAdminAction()

/* ---- List -------------------------------------------------------------- */
const filters = reactive({
  search: '',
  status: '' as '' | ProductStatus,
  categoryId: '',
  brandId: '',
  sortBy: 'updated' as 'name' | 'priceValue' | 'created' | 'updated',
  sortOrder: 'desc' as 'asc' | 'desc',
})

const categories = ref<CategoryOptionSource[]>([])
const brands = ref<Brand[]>([])

/** Select options. A failure only empties a select; it is not worth an alert. */
async function loadReferences() {
  const [cats, brs] = await Promise.all([
    adminFetch<CategoryOptionSource[]>('/categories').catch(() => []),
    adminFetch<Brand[]>('/brands').catch(() => []),
  ])
  categories.value = cats
  brands.value = brs
}

const {
  rows: products,
  pagination,
  loading,
  error: loadError,
  load,
  setPage,
} = useAdminList<AdminProduct, Paginated<AdminProduct>>('/products', {
  params: () => ({ ...filters }),
  debounce: 350,
  errorText: 'Не удалось загрузить товары',
  // Only rows on screen can stay selected — see the bulk section.
  onResponse: response => pruneSelection(response.data),
  immediate: false,
})

// The list does not need the selects to render, so neither waits for the other.
onMounted(() => {
  void loadReferences()
  void load()
})

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
  costPrice: null as number | null,
  pricingMode: 'AUTO' as 'AUTO' | 'MANUAL',
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

function openCreate() {
  editing.value = null
  Object.assign(form, blankForm())
  form.categoryId = categoryOptions.value[0]?.value ?? ''
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
    costPrice: product.costPrice,
    pricingMode: product.pricingMode ?? 'AUTO',
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

/** Live margin readout in the editor, so pricing decisions are visible. */
const editorMargin = computed(() => {
  const cost = numOrNull(form.costPrice)
  const price = numOrNull(form.priceValue)
  if (cost == null || price == null || cost <= 0) return null
  const absolute = Math.round((price - cost) * 100) / 100
  return { absolute, percent: Math.round((absolute / cost) * 1000) / 10 }
})

const discountPercent = computed(() => {
  const oldPrice = numOrNull(form.oldPrice)
  const price = numOrNull(form.priceValue)
  if (!oldPrice || !price || oldPrice <= price) return 0
  return Math.round((1 - price / oldPrice) * 100)
})

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
  const oldPrice = numOrNull(form.oldPrice)
  const price = numOrNull(form.priceValue)
  if (oldPrice && price && oldPrice <= price) {
    formError.value = 'Старая цена должна быть выше текущей — иначе скидка не покажется'
    editorTab.value = 'price'
    return
  }

  // Blanks go as `null`, not dropped: the update applies only the fields it
  // is sent, so an emptied old price or description used to stay forever.
  const body = {
    name: form.name.trim(),
    slug: form.slug.trim(),
    categoryId: form.categoryId,
    brandId: form.brandId || null,
    sku: textOrNull(form.sku),
    model: textOrNull(form.model),
    priceValue: price,
    oldPrice,
    costPrice: numOrNull(form.costPrice),
    pricingMode: form.pricingMode,
    priceCurrency: form.priceCurrency || 'BYN',
    stockStatus: form.stockStatus,
    stockQuantity: numOrNull(form.stockQuantity),
    status: form.status,
    descriptionShort: textOrNull(form.descriptionShort),
    descriptionFull: textOrNull(form.descriptionFull),
    seoTitle: textOrNull(form.seoTitle),
    seoDescription: textOrNull(form.seoDescription),
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

async function confirmDelete() {
  const product = deleting.value
  if (!product) return
  await run(() => adminFetch(`/products/${product.id}`, { method: 'DELETE' }), {
    key: 'delete',
    error: 'Не удалось удалить товар',
    success: 'Товар удалён',
    after: () => {
      deleting.value = null
      return load()
    },
  })
}

/* ---- Bulk status ------------------------------------------------------- */
/**
 * The selection only ever holds rows on screen. It used to survive a page or
 * filter change, so «Скрыть» could hit products the admin could no longer
 * see, and «выбрать все» compared counts rather than ids.
 */
const selected = ref<Set<string>>(new Set())

function pruneSelection(rows: AdminProduct[]) {
  if (!selected.value.size) return
  const visible = new Set(rows.map(row => row.id))
  selected.value = new Set([...selected.value].filter(id => visible.has(id)))
}

const allSelected = computed(
  () => products.value.length > 0 && products.value.every(row => selected.value.has(row.id)),
)

function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(products.value.map(row => row.id))
}

function toggleOne(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function bulkStatus(status: ProductStatus) {
  const ids = [...selected.value]
  if (!ids.length) return
  return run(
    async () => {
      // No bulk endpoint on the API — sequential PATCHes keep it simple and
      // the selection is capped at one page (20 items).
      for (const id of ids) {
        await adminFetch(`/products/${id}`, { method: 'PATCH', body: { status } })
      }
    },
    {
      key: `bulk:${status}`,
      error: 'Не удалось обновить статус',
      success: `Обновлено товаров: ${ids.length}`,
      after: () => {
        selected.value = new Set()
        return load()
      },
    },
  )
}

/* ---- Display helpers --------------------------------------------------- */
const COLUMNS = [
  { key: 'select', label: '', width: '44px' },
  { key: 'product', label: 'Товар' },
  { key: 'category', label: 'Категория', class: 'admin-muted' },
  { key: 'price', label: 'Цена', align: 'end' as const },
  { key: 'status', label: 'Статус' },
  { key: 'actions', label: '', width: '1%', nowrap: true },
]

const categoryOptions = computed(() => categoryTreeOptions(categories.value))
const brandOptions = computed(() => brands.value.map(b => ({ value: b.id, label: b.name })))
</script>

<template>
  <div class="admin-page">
    <AdminPageHead title="Товары" :description="`${pagination.total} товаров в каталоге`">
      <UiButton @click="openCreate">Добавить товар</UiButton>
    </AdminPageHead>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div class="filters">
      <UiInput v-model="filters.search" placeholder="Название, артикул или slug" size="sm">
        <template #leading>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm7.5 14.5L16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </template>
      </UiInput>

      <UiSelect v-model="filters.status" size="sm" :options="productStatusOptions(true)" />

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
        <UiButton size="sm" variant="secondary" :loading="busy === 'bulk:PUBLISHED'" @click="bulkStatus('PUBLISHED')">
          Опубликовать
        </UiButton>
        <UiButton size="sm" variant="secondary" :loading="busy === 'bulk:HIDDEN'" @click="bulkStatus('HIDDEN')">
          Скрыть
        </UiButton>
        <UiButton size="sm" variant="ghost" @click="selected = new Set()">Снять выделение</UiButton>
      </div>
    </Transition>

    <UiTable :columns="COLUMNS" :rows="products" row-key="id" :loading="loading">
      <template #head-select>
        <UiCheckbox :model-value="allSelected" @update:model-value="toggleAll" />
      </template>

      <template #empty>
        <UiEmpty
          icon="box"
          title="Товары не найдены"
          description="Измените фильтры или добавьте первый товар."
        />
      </template>

      <template #cell-select="{ row: product }">
        <UiCheckbox
          :model-value="selected.has(product.id)"
          @update:model-value="toggleOne(product.id)"
        />
      </template>

      <template #cell-product="{ row: product }">
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
            <!-- Откуда спаршен: supplier(s) behind this card. -->
            <AdminProductSourceNote
              :product-id="product.id"
              variant="line"
              show-empty
            />
          </div>
        </div>
      </template>

      <template #cell-category="{ row: product }">{{ product.category?.name || '—' }}</template>

      <template #cell-price="{ row: product }">
        <div class="price-cell">
          <strong>{{ formatPrice(product.priceValue, product.priceCurrency) }}</strong>
          <s v-if="product.oldPrice && product.priceValue && product.oldPrice > product.priceValue">
            {{ formatPrice(product.oldPrice, product.priceCurrency) }}
          </s>
          <span v-if="product.costPrice && product.priceValue" class="margin-hint">
            маржа {{ Math.round(((product.priceValue - product.costPrice) / product.costPrice) * 100) }}%
          </span>
        </div>
      </template>

      <template #cell-status="{ row: product }">
        <UiBadge :tone="PRODUCT_STATUS_TONE[product.status]" size="sm">
          {{ PRODUCT_STATUS_LABEL[product.status] }}
        </UiBadge>
      </template>

      <template #cell-actions="{ row: product }">
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
      </template>
    </UiTable>

    <UiPagination
      :page="pagination.page"
      :pages="pagination.pages"
      :total="pagination.total"
      @change="setPage"
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

      <div v-show="editorTab === 'main'" class="admin-form editor-pane">
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

        <div class="admin-form-row">
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

        <div class="admin-form-row">
          <UiField label="Артикул" for="p-sku">
            <UiInput id="p-sku" v-model="form.sku" />
          </UiField>
          <UiField label="Модель" for="p-model">
            <UiInput id="p-model" v-model="form.model" />
          </UiField>
        </div>

        <UiField label="Статус" for="p-status">
          <UiSelect id="p-status" v-model="form.status" :options="productStatusOptions()" />
        </UiField>
      </div>

      <div v-show="editorTab === 'price'" class="admin-form editor-pane">
        <UiField
          label="Режим цены"
          :hint="form.pricingMode === 'AUTO'
            ? 'Цена считается правилами наценки и обновляется при каждом парсинге'
            : 'Цена закреплена вручную — парсинг её не перезапишет'"
          for="p-mode"
        >
          <UiSelect
            id="p-mode"
            v-model="form.pricingMode"
            :options="[
              { value: 'AUTO', label: 'Автоматически по правилам' },
              { value: 'MANUAL', label: 'Вручную (зафиксировать)' }
            ]"
          />
        </UiField>

        <div class="admin-form-row">
          <UiField label="Закупочная цена" hint="Основа для расчёта наценки" for="p-cost">
            <UiInput id="p-cost" v-model="form.costPrice" type="number" step="0.01" min="0" />
          </UiField>

          <UiField
            label="Маржа"
            :hint="editorMargin ? `${editorMargin.absolute} BYN` : 'укажите закупку и цену'"
            for="p-margin"
          >
            <UiInput
              id="p-margin"
              :model-value="editorMargin ? `${editorMargin.percent}%` : '—'"
              readonly
              disabled
            />
          </UiField>
        </div>

        <div class="admin-form-row">
          <UiField
            label="Цена"
            :hint="form.pricingMode === 'AUTO' ? 'Будет пересчитана правилами' : undefined"
            for="p-price"
          >
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

        <div class="admin-form-row">
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

      <div v-show="editorTab === 'seo'" class="admin-form editor-pane">
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
    <UiConfirm
      :open="Boolean(deleting)"
      title="Удалить товар?"
      :busy="busy === 'delete'"
      @update:open="deleting = null"
      @confirm="confirmDelete"
    >
      Товар «{{ deleting?.name }}» будет удалён вместе с изображениями и характеристиками.
      Действие необратимо.
    </UiConfirm>
  </div>
</template>

<style scoped>
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

.margin-hint {
  color: var(--success);
  font-size: var(--text-xs);
  font-weight: 600;
}

.row-actions {
  display: flex;
  gap: var(--space-1);
}

/* ---- Editor ---- */
/* Room between the editor's tabs and the fields under them. */
.editor-pane {
  padding-top: var(--space-5);
}

.form-error {
  margin-top: var(--space-4);
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
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
