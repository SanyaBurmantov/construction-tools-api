<script setup lang="ts">
import type { DataQualityReport } from '~/types/parsing'

/**
 * «Качество данных» — the heavy report (a scan of the whole catalogue), which
 * is why the page loads it separately from everything else.
 */
const props = defineProps<{
  report: DataQualityReport | null
  loading: boolean
}>()

defineEmits<{ reload: [] }>()

const metrics = computed(() => {
  const report = props.report
  if (!report) return []
  return [
    { key: 'withoutImages', label: 'Без фото', count: report.summary.withoutImages, items: report.samples.withoutImages },
    { key: 'withoutPrice', label: 'Без цены', count: report.summary.withoutPrice, items: report.samples.withoutPrice },
    { key: 'withoutSpecs', label: 'Без характеристик', count: report.summary.withoutSpecs, items: report.samples.withoutSpecs },
    { key: 'inFallbackCategory', label: 'Неразобранная категория', count: report.summary.inFallbackCategory, items: report.samples.inFallbackCategory },
    { key: 'stale', label: `Не обновлялись > ${report.summary.staleDays} дн.`, count: report.summary.staleProducts, items: report.samples.stale },
    { key: 'allCaps', label: 'Название КАПСОМ', count: report.summary.allCapsNames, items: report.samples.allCapsNames },
    // Cleared when an admin saves the product (or edits its name).
    { key: 'supplierRenamed', label: 'Поставщик переименовал (проверить)', count: report.summary.supplierRenamed ?? 0, items: report.samples.supplierRenamed ?? [] },
  ]
})
</script>

<template>
  <UiCard :padded="false">
    <template #header>
      <div class="card-head">
        <h2>Качество данных</h2>
        <p>
          Опубликовано {{ report?.summary.publishedProducts ?? '—' }} из
          {{ report?.summary.totalProducts ?? '—' }} товаров.
          Отчёт от {{ report ? formatDateTime(report.generatedAt) : '…' }}.
        </p>
      </div>
    </template>
    <template #actions>
      <UiButton variant="secondary" size="sm" :loading="loading" @click="$emit('reload')">
        Пересчитать
      </UiButton>
    </template>

    <div v-if="report" class="quality-grid pad">
      <details v-for="metric in metrics" :key="metric.key" class="quality-item" :class="{ ok: !metric.count }">
        <summary>
          <strong>{{ metric.count }}</strong>
          <span>{{ metric.label }}</span>
        </summary>
        <ul v-if="metric.items.length">
          <li v-for="item in metric.items" :key="item.id">
            <a :href="`/product/${item.slug}`" target="_blank" rel="noreferrer">{{ item.name }}</a>
          </li>
          <li v-if="metric.count > metric.items.length" class="muted">
            … и ещё {{ metric.count - metric.items.length }}
          </li>
        </ul>
        <p v-else class="muted">Проблем нет.</p>
      </details>

      <details class="quality-item" :class="{ ok: !report.summary.duplicateGroups }">
        <summary>
          <strong>{{ report.summary.duplicateGroups }}</strong>
          <span>Возможные дубли</span>
        </summary>
        <ul v-if="report.samples.duplicates.length">
          <li v-for="group in report.samples.duplicates" :key="group.key" class="dup-group">
            <strong>{{ group.key }}</strong>
            <a
              v-for="item in group.products"
              :key="item.id"
              :href="`/product/${item.slug}`"
              target="_blank"
              rel="noreferrer"
            >
              {{ item.name }}
              <small v-if="item.sources.length">({{ item.sources.join(', ') }})</small>
            </a>
          </li>
        </ul>
        <p v-else class="muted">Дубликатов не найдено.</p>
      </details>
    </div>
    <p v-else class="pad muted">
      {{ loading ? 'Считаем отчёт…' : 'Отчёт ещё не загружен.' }}
    </p>
  </UiCard>
</template>

<style scoped>
.quality-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-3);
}

.quality-item {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.quality-item summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  cursor: pointer;
  list-style: none;
}

.quality-item summary::-webkit-details-marker {
  display: none;
}

.quality-item summary strong {
  color: var(--danger);
  font-size: var(--text-2xl);
  font-weight: 800;
  line-height: 1;
}

.quality-item summary span {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.quality-item.ok summary strong {
  color: var(--success);
}

.quality-item ul {
  display: grid;
  max-height: 240px;
  gap: var(--space-1);
  margin: var(--space-3) 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  font-size: var(--text-sm);
}

.quality-item a {
  color: var(--text-link);
  overflow-wrap: anywhere;
}

.dup-group {
  display: grid;
  gap: var(--space-1);
  padding-top: var(--space-2);
  border-top: 1px dashed var(--border-subtle);
}

.dup-group a {
  display: block;
}
</style>
