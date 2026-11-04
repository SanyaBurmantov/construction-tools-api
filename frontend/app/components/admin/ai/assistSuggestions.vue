<script setup lang="ts">
/**
 * What the assistant proposes, one kind at a time: categories for the
 * fallback's products, search synonyms, characteristics to fold, size lines.
 * «Принять» applies, «Отклонить» keeps it from being proposed again,
 * «Откатить» undoes an applied one where its result is still in place.
 */
import type { AiSuggestion, AiSuggestionKind, AiSuggestionStatus } from '~/types/ai'
import type { Paginated } from '~/types/api'

const props = defineProps<{
  pending: Partial<Record<AiSuggestionKind, number>>
  autoApplied: number
}>()
const emit = defineEmits<{ changed: [] }>()

const { adminFetch } = useAdminApi()
const { run, busy } = useAdminAction()

type View = 'CATEGORY' | 'CATEGORY_AUTO' | 'SYNONYM' | 'SPEC_MERGE' | 'VARIANT'
const view = ref<View>('CATEGORY')
const status = ref<AiSuggestionStatus>('PENDING')

const views = computed(() => [
  { value: 'CATEGORY', label: 'Категории товаров', count: props.pending.CATEGORY || null },
  { value: 'CATEGORY_AUTO', label: 'Категории — применено само', count: props.autoApplied || null },
  { value: 'SYNONYM', label: 'Синонимы поиска', count: props.pending.SYNONYM || null },
  { value: 'SPEC_MERGE', label: 'Характеристики', count: props.pending.SPEC_MERGE || null },
  { value: 'VARIANT', label: 'Линейки размеров', count: props.pending.VARIANT || null },
])

const rows = ref<AiSuggestion[]>([])
const page = ref(1)
const pages = ref(1)
const total = ref(0)
const loading = ref(false)
let ticket = 0

async function load() {
  const mine = ++ticket
  loading.value = true
  const auto = view.value === 'CATEGORY_AUTO'
  try {
    const response = await adminFetch<Paginated<AiSuggestion>>('/ai/assist/suggestions', {
      params: compactParams({
        kind: auto ? 'CATEGORY' : view.value,
        status: auto ? 'APPLIED' : status.value,
        auto: auto ? 'true' : undefined,
        page: page.value,
      }),
    })
    if (mine !== ticket) return
    rows.value = response.data
    pages.value = response.pagination.pages
    total.value = response.pagination.total
  } catch {
    if (mine === ticket) rows.value = []
  } finally {
    if (mine === ticket) loading.value = false
  }
}

watch([view, status], () => {
  page.value = 1
  void load()
})
onMounted(load)

function setPage(next: number) {
  page.value = next
  void load()
}

/** The admin's own pick among a category proposal's candidates. */
const picks = ref<Record<string, string>>({})
const pickOf = (row: AiSuggestion) => picks.value[row.id] ?? row.payload.to ?? ''
function candidateOptions(row: AiSuggestion) {
  const candidates = (row.payload.candidates ?? []) as Array<{ id: string, path: string }>
  return [
    { value: '', label: 'Выберите категорию' },
    ...candidates.map(candidate => ({ value: candidate.id, label: candidate.path })),
  ]
}

function act(row: AiSuggestion, action: 'apply' | 'reject' | 'revert') {
  const body = action === 'apply' && row.kind === 'CATEGORY' ? { categoryId: pickOf(row) || undefined } : undefined
  return run(() => adminFetch(`/ai/assist/suggestions/${row.id}/${action}`, { method: 'POST', body }), {
    key: `${row.id}:${action}`,
    error: 'Не удалось',
    success: action === 'apply' ? 'Применено' : action === 'reject' ? 'Отклонено' : 'Откачено',
    after: async () => {
      await load()
      emit('changed')
    },
  })
}

const canRevert = (row: AiSuggestion) => row.status === 'APPLIED' && row.kind !== 'SPEC_MERGE'
const STATUS_TABS = [
  { value: 'PENDING', label: 'Ждут решения' },
  { value: 'APPLIED', label: 'Применены' },
  { value: 'REJECTED', label: 'Отклонены' },
  { value: 'REVERTED', label: 'Откачены' },
]
</script>

<template>
  <div class="suggestions">
    <UiTabs :model-value="view" :tabs="views" @update:model-value="view = $event as View" />
    <UiTabs
      v-if="view !== 'CATEGORY_AUTO'"
      :model-value="status"
      :tabs="STATUS_TABS"
      @update:model-value="status = $event as AiSuggestionStatus"
    />
    <p v-if="view === 'SPEC_MERGE'" class="muted">
      Склейка характеристик не откатывается кнопкой: ночной пересчёт сливает строки одного раздела. Принимайте, когда уверены.
    </p>

    <UiSkeleton v-if="loading && !rows.length" :lines="5" height="18px" />
    <UiEmpty v-else-if="!rows.length" icon="box" title="Пусто" description="Помощник ещё ничего не предложил здесь — включите работу выше." />

    <ul v-else class="list">
      <li v-for="row in rows" :key="row.id" class="item">
        <div class="head">
          <strong>{{ row.title }}</strong>
          <UiBadge v-if="row.auto" size="sm" tone="info">сам</UiBadge>
          <span class="muted">{{ formatDateTime(row.decidedAt ?? row.createdAt) }}<template v-if="row.decidedBy"> · {{ row.decidedBy }}</template></span>
        </div>

        <!-- Category -->
        <template v-if="row.kind === 'CATEGORY'">
          <p v-if="row.payload.toPath" class="line">→ {{ row.payload.toPath }}</p>
          <p v-if="row.payload.reason" class="muted">{{ row.payload.reason }}</p>
          <UiSelect
            v-if="row.status === 'PENDING' && row.payload.candidates?.length"
            :model-value="pickOf(row)"
            size="sm"
            aria-label="Категория"
            :options="candidateOptions(row)"
            @update:model-value="picks = { ...picks, [row.id]: String($event) }"
          />
        </template>

        <!-- Synonym -->
        <template v-else-if="row.kind === 'SYNONYM'">
          <p class="line">
            <span v-for="word in row.payload.group ?? []" :key="word" class="chip">{{ word }}…</span>
          </p>
          <p class="muted">
            Искали {{ row.payload.searches }} раз<template v-if="row.payload.wouldFind"> · с синонимом найдётся {{ row.payload.wouldFind }} товаров</template>
            <template v-if="row.payload.reason"> · {{ row.payload.reason }}</template>
          </p>
          <p v-if="row.payload.examples?.length" class="muted">Например: {{ row.payload.examples.join('; ') }}</p>
        </template>

        <!-- Spec merge -->
        <template v-else-if="row.kind === 'SPEC_MERGE'">
          <p class="muted">Раздел «{{ row.payload.category }}» → одна характеристика «{{ row.payload.name }}»</p>
          <ul class="members">
            <li v-for="member in row.payload.members ?? []" :key="member.key">
              <strong>{{ member.name }}</strong><template v-if="member.unit">, {{ member.unit }}</template>
              <span class="muted"> — {{ member.products }} тов.; {{ (member.samples ?? []).join(', ') }}</span>
            </li>
          </ul>
        </template>

        <!-- Variant line -->
        <template v-else-if="row.kind === 'VARIANT'">
          <p class="line">Линейка: <strong>{{ row.payload.line }}</strong></p>
          <ul class="members">
            <li v-for="member in row.payload.members ?? []" :key="member.id">
              <span class="chip">{{ member.label }}</span> {{ row.payload.names?.[member.id] ?? member.id }}
            </li>
          </ul>
        </template>

        <div class="actions">
          <template v-if="row.status === 'PENDING'">
            <UiButton size="sm" :loading="busy === `${row.id}:apply`" :disabled="row.kind === 'CATEGORY' && !pickOf(row)" @click="act(row, 'apply')">Принять</UiButton>
            <UiButton size="sm" variant="ghost" :loading="busy === `${row.id}:reject`" @click="act(row, 'reject')">Отклонить</UiButton>
          </template>
          <UiButton v-else-if="canRevert(row)" size="sm" variant="ghost" :loading="busy === `${row.id}:revert`" @click="act(row, 'revert')">Откатить</UiButton>
        </div>
      </li>
    </ul>

    <UiPagination :page="page" :pages="pages" :total="total" @change="setPage" />
  </div>
</template>

<style scoped>
.suggestions {
  display: flex;
  flex-direction: column;
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

.line {
  margin: 0;
  font-size: var(--text-sm);
}

.chip {
  display: inline-block;
  margin-right: var(--space-1);
  padding: 0 var(--space-2);
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  font-size: var(--text-xs);
  font-weight: 600;
}

.members {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding-left: var(--space-4);
  gap: var(--space-1);
  font-size: var(--text-sm);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
