<script setup lang="ts">
import type { Source } from '~/types/parsing'

/** «Добавить товар из источника» — a single supplier URL parsed into the catalogue. */
const props = defineProps<{
  sources: Source[]
  /** Edited in place; the page keeps the form so a failed import keeps the URL. */
  form: { sourceId: string | null, url: string }
  importing: boolean
}>()

defineEmits<{ submit: [] }>()

// See `queuePanel.vue`: the inputs edit the page's own reactive object.
const form = computed(() => props.form)
</script>

<template>
  <UiCard>
    <template #header>
      <div class="card-head">
        <h2>Добавить товар из источника</h2>
        <p>Ссылка на карточку товара у поставщика — товар будет спарсен в каталог.</p>
      </div>
    </template>

    <form class="import-form" @submit.prevent="$emit('submit')">
      <UiSelect
        v-model="form.sourceId"
        placeholder="Источник"
        :options="sources.map(source => ({ value: source.id, label: source.name }))"
      />
      <UiInput v-model="form.url" type="url" placeholder="https://…" />
      <UiButton type="submit" :loading="importing" :disabled="!form.sourceId || !form.url">
        Добавить
      </UiButton>
    </form>
    <p v-if="!sources.length" class="muted">Источники не найдены — сначала заведите источник.</p>
  </UiCard>
</template>

<style scoped>
.import-form {
  display: grid;
  gap: var(--space-2);
}

@media (min-width: 720px) {
  .import-form {
    grid-template-columns: 240px minmax(0, 1fr) auto;
  }
}
</style>
