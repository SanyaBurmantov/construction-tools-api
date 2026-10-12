<script setup lang="ts">
import type { ParserError } from '~/types/parsing'

/** «Лог ошибок парсинга» — newest first, capped server-side. */
const props = defineProps<{ errors: ParserError[] }>()

defineEmits<{ clear: [] }>()

/**
 * The log is capped at 200 rows server-side, so a bare `.length` silently pins
 * at 200 and stops meaning anything. Say "200+" when we're at the cap.
 */
const CAP = 200
const countLabel = computed(() =>
  props.errors.length >= CAP ? `${CAP}+` : String(props.errors.length)
)
</script>

<template>
  <UiCard :padded="false">
    <template #header>
      <div class="card-head">
        <h2>Лог ошибок парсинга</h2>
        <p>{{ countLabel }} записей, новые сверху. Хранятся последние {{ CAP }}.</p>
      </div>
    </template>
    <template #actions>
      <UiButton variant="secondary" size="sm" :disabled="!errors.length" @click="$emit('clear')">
        Очистить
      </UiButton>
    </template>

    <UiTable
      :columns="[
        { key: 'createdAt', label: 'Когда', width: '150px', nowrap: true },
        { key: 'message', label: 'Ошибка' },
        { key: 'url', label: 'URL' }
      ]"
      :rows="errors"
      empty-text="Ошибок пока нет."
    >
      <template #cell-createdAt="{ row }">
        <span class="muted">{{ formatDateTime(row.createdAt) }}</span>
      </template>
      <template #cell-message="{ row }">
        <span class="danger">{{ row.message }}</span>
      </template>
      <template #cell-url="{ row }">
        <a class="url" :href="row.url" target="_blank" rel="noreferrer">{{ row.url }}</a>
      </template>
    </UiTable>
  </UiCard>
</template>
