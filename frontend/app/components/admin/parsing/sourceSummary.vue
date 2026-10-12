<script setup lang="ts">
import type { SupplierSummary } from '~/types/parsing'

/** «Каталог по источникам» — what each supplier contributes, and what's missing. */
defineProps<{ rows: SupplierSummary[] }>()
</script>

<template>
  <UiCard :padded="false">
    <template #header>
      <div class="card-head">
        <h2>Каталог по источникам</h2>
        <p>Сколько товаров поставщика видно на витрине и где не хватает базовых данных.</p>
      </div>
    </template>

    <UiTable
      :columns="[
        { key: 'name', label: 'Источник' },
        { key: 'published', label: 'На витрине', width: '120px', align: 'end' },
        { key: 'total', label: 'Всего', width: '90px', align: 'end' },
        { key: 'gaps', label: 'Пробелы в данных', width: '260px' }
      ]"
      :rows="rows"
      empty-text="Источников пока нет."
    >
      <template #cell-name="{ row }">
        <strong>{{ row.source.name }}</strong>
        <span class="code">{{ row.source.code }}</span>
      </template>
      <template #cell-published="{ row }">
        {{ row.published }}
        <UiBadge v-if="row.draft" tone="warning" size="sm">+{{ row.draft }} черновиков</UiBadge>
      </template>
      <template #cell-total="{ row }">
        <span :title="`скрыто: ${row.hidden}, в архиве: ${row.archived}`">{{ row.total }}</span>
      </template>
      <template #cell-gaps="{ row }">
        <div class="gaps">
          <UiBadge :tone="row.withoutImages ? 'danger' : 'neutral'" size="sm">
            без фото: {{ row.withoutImages }}
          </UiBadge>
          <UiBadge :tone="row.withoutPrice ? 'danger' : 'neutral'" size="sm">
            без цены: {{ row.withoutPrice }}
          </UiBadge>
          <UiBadge :tone="row.withoutSku ? 'warning' : 'neutral'" size="sm">
            без SKU: {{ row.withoutSku }}
          </UiBadge>
        </div>
      </template>
    </UiTable>
  </UiCard>
</template>

<style scoped>
.gaps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
</style>
