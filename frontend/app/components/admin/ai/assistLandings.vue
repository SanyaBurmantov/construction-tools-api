<script setup lang="ts">
/**
 * The «категория + бренд» landings the assistant wrote. A published one is
 * the canonical page `/catalog/<категория>?brands=<бренд>` with its own
 * heading and text, and is in the sitemap; «Скрыть» turns it back into a
 * plain filtered view; «Переписать» deletes it so the job writes it afresh.
 */
import type { AiLanding } from '~/types/ai'
import type { Paginated } from '~/types/api'

const emit = defineEmits<{ changed: [] }>()
const { adminFetch } = useAdminApi()
const { run, busy } = useAdminAction()

const filter = ref('')
const rows = ref<AiLanding[]>([])
const page = ref(1)
const pages = ref(1)
const total = ref(0)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const response = await adminFetch<Paginated<AiLanding>>('/ai/assist/landings', {
      params: compactParams({ page: page.value, published: filter.value }),
    })
    rows.value = response.data
    pages.value = response.pagination.pages
    total.value = response.pagination.total
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}

watch(filter, () => {
  page.value = 1
  void load()
})
onMounted(load)

function setPage(next: number) {
  page.value = next
  void load()
}

const after = async () => {
  await load()
  emit('changed')
}

const toggle = (row: AiLanding) =>
  run(() => adminFetch(`/ai/assist/landings/${row.id}`, { method: 'PATCH', body: { isPublished: !row.isPublished } }), {
    key: `landing:${row.id}`,
    error: 'Не удалось',
    success: row.isPublished ? 'Скрыта' : 'Опубликована',
    after,
  })

const rewrite = (row: AiLanding) =>
  run(() => adminFetch(`/ai/assist/landings/${row.id}`, { method: 'DELETE' }), {
    key: `landing:${row.id}:delete`,
    error: 'Не удалось',
    success: 'Удалена — помощник напишет её заново',
    after,
  })

const url = (row: AiLanding) => `/catalog/${row.category.slug}?brands=${row.brand.id}`
</script>

<template>
  <div class="landings">
    <div class="toolbar">
      <UiSelect
        v-model="filter"
        size="sm"
        aria-label="Показать"
        :options="[
          { value: '', label: 'Все страницы' },
          { value: 'true', label: 'Опубликованные' },
          { value: 'false', label: 'Не прошли проверки / скрытые' }
        ]"
      />
      <span class="muted">Пишутся для сочетаний, где у бренда в категории от 6 товаров на витрине.</span>
    </div>

    <UiSkeleton v-if="loading && !rows.length" :lines="5" height="18px" />
    <UiEmpty v-else-if="!rows.length" icon="box" title="Страниц пока нет" description="Включите работу «Посадочные „категория + бренд“» выше." />

    <ul v-else class="list">
      <li v-for="row in rows" :key="row.id" class="item">
        <div class="head">
          <a :href="url(row)" target="_blank" rel="noopener"><strong>{{ row.h1 }}</strong></a>
          <UiBadge size="sm" :tone="row.isPublished ? 'success' : 'warning'">{{ row.isPublished ? 'опубликована' : 'не опубликована' }}</UiBadge>
          <span class="muted">{{ row.brand.name }} · {{ row.category.name }} · {{ row.productCount }} тов.</span>
        </div>
        <p v-for="(reason, key) in row.rejected ?? {}" :key="key" class="error">{{ key }}: {{ reason }}</p>
        <details>
          <summary>Тексты</summary>
          <p class="muted"><strong>Title:</strong> {{ row.seoTitle }}</p>
          <p class="muted"><strong>Description:</strong> {{ row.seoDescription }}</p>
          <p class="text">{{ row.description }}</p>
        </details>
        <div class="actions">
          <UiButton size="sm" variant="secondary" :loading="busy === `landing:${row.id}`" @click="toggle(row)">
            {{ row.isPublished ? 'Скрыть' : 'Опубликовать' }}
          </UiButton>
          <UiButton size="sm" variant="ghost" :loading="busy === `landing:${row.id}:delete`" @click="rewrite(row)">Переписать</UiButton>
        </div>
      </li>
    </ul>

    <UiPagination :page="page" :pages="pages" :total="total" @change="setPage" />
  </div>
</template>

<style scoped>
.landings {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.muted {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-3);
  list-style: none;
}

.item {
  display: flex;
  flex-direction: column;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-2);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.head a {
  color: var(--text-strong);
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
}

.text {
  font-size: var(--text-sm);
  white-space: pre-wrap;
}

summary {
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 600;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
