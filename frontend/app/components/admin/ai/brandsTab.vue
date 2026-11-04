<script setup lang="ts">
import type { AiBrandRow } from '~/types/ai'

defineEmits<{ created: [] }>()

const filters = reactive({
  search: '',
  missing: '',
  withProducts: 'yes',
})

const FILL_COLUMNS = [
  { key: 'description', label: 'Описание' },
  { key: 'seoTitle', label: 'Title' },
  { key: 'seoDescription', label: 'Meta' },
]
</script>

<template>
  <AdminAiPickerPage
    entity="BRAND"
    path="/ai/brands"
    :filters="filters"
    :fill-columns="FILL_COLUMNS"
    :extra-columns="2"
    noun="бренды"
    error-text="Не удалось загрузить бренды"
    @created="$emit('created')"
  >
    <template #filters>
      <UiInput v-model="filters.search" placeholder="Название бренда" size="sm" aria-label="Поиск" />
      <UiSelect
        v-model="filters.missing"
        size="sm"
        :options="[
          { value: '', label: 'Заполненность — любая' },
          { value: 'description', label: 'Без описания' },
          { value: 'seo', label: 'SEO не написано' }
        ]"
      />
      <UiSelect
        v-model="filters.withProducts"
        size="sm"
        :options="[
          { value: 'yes', label: 'С товарами на витрине' },
          { value: '', label: 'Все бренды' }
        ]"
      />
    </template>

    <template #columns>
      <th>Бренд</th>
      <th class="num">Товаров</th>
    </template>
    <template #row="{ row }: { row: AiBrandRow }">
      <td>
        <a :href="`/brand/${row.slug}`" target="_blank" rel="noopener" class="name">{{ row.name }}</a>
        <small v-if="row.country">{{ row.country }}</small>
      </td>
      <td class="num">{{ row.products }}</td>
    </template>
  </AdminAiPickerPage>
</template>

<style scoped>
.name {
  color: var(--text-strong);
  font-weight: 600;
}
</style>
