<script setup lang="ts">
import type { AiCategoryRow } from '~/types/ai'
import type { CategoryOptionSource } from '~/utils/category-options'

definePageMeta({ layout: 'admin' })

const { adminFetch } = useAdminApi()

const filters = reactive({
  search: '',
  parentId: '',
  level: '',
  visible: '',
  missing: '',
})

const categories = ref<CategoryOptionSource[]>([])

const branchOptions = computed(() => [
  { value: '', label: 'Все ветки' },
  ...categoryTreeOptions(categories.value),
])

onMounted(async () => {
  categories.value = await adminFetch<CategoryOptionSource[]>('/categories').catch(() => [])
})

const FILL_COLUMNS = [
  { key: 'description', label: 'Описание' },
  { key: 'seoTitle', label: 'Title' },
  { key: 'seoDescription', label: 'Meta' },
]
</script>

<template>
  <AdminAiPickerPage
    title="ИИ · Категории"
    description="Выберите категории, затем поля и промпт — модель перепишет описания и SEO"
    entity="CATEGORY"
    path="/ai/categories"
    :filters="filters"
    :fill-columns="FILL_COLUMNS"
    :extra-columns="3"
    noun="категории"
    error-text="Не удалось загрузить категории"
  >
    <template #filters>
      <UiInput v-model="filters.search" placeholder="Название категории" size="sm" aria-label="Поиск" />
      <UiSelect v-model="filters.parentId" size="sm" :options="branchOptions" />
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
    </template>

    <template #columns>
      <th>Категория</th>
      <th>Родитель</th>
      <th class="num">Товаров</th>
    </template>
    <template #row="{ row }: { row: AiCategoryRow }">
      <td>
        <a :href="`/catalog/${row.slug}`" target="_blank" rel="noopener" class="name">{{ row.name }}</a>
        <small>Уровень {{ row.level + 1 }}<template v-if="!row.isVisible"> · скрыта</template></small>
      </td>
      <td>{{ row.parent?.name ?? '—' }}</td>
      <td class="num">{{ row._count.products }}</td>
    </template>
  </AdminAiPickerPage>
</template>

<style scoped>
.name {
  color: var(--text-strong);
  font-weight: 600;
}
</style>
