<script setup lang="ts">
import type { ParserRun } from '~/types/parsing'

/** «История запусков» — the last runs, how long they took and how they ended. */
defineProps<{ runs: ParserRun[] }>()
</script>

<template>
  <UiCard :padded="false">
    <template #header>
      <div class="card-head">
        <h2>История запусков</h2>
        <p>Последние 20 запусков — сколько шли и чем закончились.</p>
      </div>
    </template>

    <UiTable
      :columns="[
        { key: 'label', label: 'Парсер' },
        { key: 'status', label: 'Итог', width: '110px', nowrap: true },
        { key: 'startedAt', label: 'Старт', width: '150px', nowrap: true },
        { key: 'durationMs', label: 'Длительность', width: '130px', nowrap: true },
        { key: 'errorCount', label: 'Ошибок', width: '90px', align: 'end' }
      ]"
      :rows="runs"
      row-key="id"
      empty-text="Запусков ещё не было."
    >
      <template #cell-status="{ row }">
        <UiBadge
          size="sm"
          :tone="row.status === 'SUCCESS' ? 'success' : row.status === 'RUNNING' ? 'info' : 'danger'"
        >
          {{ row.status === 'SUCCESS' ? 'Успех' : row.status === 'RUNNING' ? 'Идёт' : 'Сбой' }}
        </UiBadge>
      </template>
      <template #cell-startedAt="{ row }">
        <span class="muted">{{ formatDateTime(row.startedAt) }}</span>
      </template>
      <template #cell-durationMs="{ row }">
        <span class="muted">{{ formatDuration(row.durationMs) }}</span>
      </template>
      <template #cell-errorCount="{ row }">
        <span :class="{ danger: row.errorCount > 0 }">{{ row.errorCount }}</span>
      </template>
    </UiTable>
  </UiCard>
</template>
