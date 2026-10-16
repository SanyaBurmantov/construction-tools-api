<script setup lang="ts">
import type { Brand } from '~/types/api'
import type { AiProductRow } from '~/types/ai'
import type { Source } from '~/types/parsing'
import type { CategoryOptionSource } from '~/utils/category-options'

definePageMeta({ layout: 'admin' })

const { adminFetch } = useAdminApi()

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

/* ---- References -------------------------------------------------------- */
const categories = ref<CategoryOptionSource[]>([])
const brands = ref<Brand[]>([])
const sources = ref<Array<Pick<Source, 'id' | 'name'>>>([])

const categoryOptions = computed(() => [
  { value: '', label: 'Все категории' },
  ...categoryTreeOptions(categories.value),
])

onMounted(async () => {
  // Decoration for the selects: a failed one leaves its filter with «Все».
  const [cats, brs, srcs] = await Promise.all([
    adminFetch<CategoryOptionSource[]>('/categories').catch(() => []),
    adminFetch<Brand[]>('/brands').catch(() => []),
    adminFetch<Source[]>('/sources').catch(() => []),
  ])
  categories.value = cats
  brands.value = brs
  sources.value = srcs
})

const FILL_COLUMNS = [
  { key: 'descriptionShort', label: 'Кратк.' },
  { key: 'descriptionFull', label: 'Описание' },
  { key: 'seoTitle', label: 'Title' },
  { key: 'seoDescription', label: 'Meta' },
]
</script>

<template>
  <AdminAiPickerPage
    title="ИИ · Товары"
    description="Выберите товары, затем поля и промпт — модель перепишет тексты, а программа обновит карточки"
    entity="PRODUCT"
    path="/ai/products"
    :filters="filters"
    :fill-columns="FILL_COLUMNS"
    :extra-columns="3"
    noun="товары"
    error-text="Не удалось загрузить товары"
  >
    <template #filters>
      <UiInput v-model="filters.search" placeholder="Название или артикул" size="sm" aria-label="Поиск" />
      <UiSelect v-model="filters.categoryId" size="sm" :options="categoryOptions" />
      <UiSelect
        v-model="filters.brandId"
        size="sm"
        :options="[{ value: '', label: 'Все бренды' }, ...brands.map(b => ({ value: b.id, label: b.name }))]"
      />
      <UiSelect
        v-model="filters.sourceId"
        size="sm"
        :options="[{ value: '', label: 'Все поставщики' }, ...sources.map(s => ({ value: s.id, label: s.name }))]"
      />
      <UiSelect v-model="filters.status" size="sm" :options="productStatusOptions(true)" />
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
    </template>

    <template #columns>
      <th>Товар</th>
      <th>Категория / бренд</th>
    </template>
    <template #row="{ row }: { row: AiProductRow }">
      <td>
        <div class="product">
          <img v-if="row.image" :src="row.image" alt="" loading="lazy">
          <div>
            <a :href="`/product/${row.slug}`" target="_blank" rel="noopener">{{ row.name }}</a>
            <small v-if="row.sku">Арт. {{ row.sku }}</small>
            <small v-if="row.aiLockedFields.length" class="ai-mark">
              ИИ: {{ row.aiLockedFields.length }} пол.
            </small>
          </div>
        </div>
      </td>
      <td>
        <span>{{ row.category?.name }}</span>
        <small v-if="row.brand">{{ row.brand.name }}</small>
      </td>
    </template>

    <template #columns-end>
      <th>Статус</th>
    </template>
    <template #row-end="{ row }: { row: AiProductRow }">
      <td>
        <UiBadge size="sm" :tone="PRODUCT_STATUS_TONE[row.status]">
          {{ PRODUCT_STATUS_LABEL[row.status] }}
        </UiBadge>
      </td>
    </template>
  </AdminAiPickerPage>
</template>

<style scoped>
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

.product small.ai-mark {
  color: var(--brand);
}
</style>
