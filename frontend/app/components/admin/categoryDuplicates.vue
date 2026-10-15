<script setup lang="ts">
/**
 * Same-named sibling categories («Двигатель» ×6 under one parent) and a
 * reviewed one-click merge per group. The backend checks that every merged
 * row really is a same-named sibling of the survivor, and the merge folds
 * same-named children too, leaving a 301 from every old slug.
 *
 * Emits `merged` so the page reloads its tree.
 */
import type { DuplicateCategoriesResponse, DuplicateCategoryGroup } from '~/types/api'

const emit = defineEmits<{ merged: [] }>()

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()

const groups = ref<DuplicateCategoryGroup[]>([])
const totals = ref<DuplicateCategoriesResponse['totals']>({ groups: 0, redundantCategories: 0 })
const loading = ref(false)
const loadError = ref('')
/** Survivor chosen per group; defaults to the server's suggestion. */
const targets = ref<Record<string, string>>({})
const busy = ref<Set<string>>(new Set())
const mergingAll = ref(false)

const groupId = (group: DuplicateCategoryGroup) => `${group.parent?.id ?? 'root'}:${group.key}`

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await adminFetch<DuplicateCategoriesResponse>('/categories/duplicates')
    groups.value = response.groups
    totals.value = response.totals
    targets.value = Object.fromEntries(response.groups.map((group) => [groupId(group), group.targetId]))
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось найти дубли')
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function mergeGroup(group: DuplicateCategoryGroup, quiet = false) {
  const id = groupId(group)
  const targetId = targets.value[id] ?? group.targetId
  const sourceIds = group.categories.map((category) => category.id).filter((categoryId) => categoryId !== targetId)
  busy.value = new Set(busy.value).add(id)
  try {
    const result = await adminFetch<{ movedProducts: number }>('/categories/duplicates/merge', {
      method: 'POST',
      body: { targetId, sourceIds },
    })
    if (!quiet) toast.success(`«${group.name}»: склеено, перенесено товаров — ${result.movedProducts}`)
    return true
  } catch (error) {
    toast.error(errorMessage(error, `Не удалось склеить «${group.name}»`))
    return false
  } finally {
    const next = new Set(busy.value)
    next.delete(id)
    busy.value = next
  }
}

async function mergeOne(group: DuplicateCategoryGroup) {
  if (await mergeGroup(group)) {
    await load()
    emit('merged')
  }
}

/** Every listed group with its chosen survivor, one after another. */
async function mergeAll() {
  mergingAll.value = true
  let done = 0
  try {
    for (const group of [...groups.value]) {
      if (await mergeGroup(group, true)) done++
    }
    toast.success(`Склеено групп: ${done} из ${groups.value.length}`)
  } finally {
    mergingAll.value = false
    await load()
    emit('merged')
  }
}
</script>

<template>
  <section class="duplicates">
    <header class="dup-head">
      <p>
        Одноимённые категории под одним родителем — обычно одна ветка, пришедшая от разных
        поставщиков. Выберите, какая останется: товары, подкатегории и настройки остальных
        перейдут в неё, со старых адресов будет 301.
      </p>
      <div class="dup-actions">
        <UiButton variant="ghost" size="sm" :disabled="loading || mergingAll" @click="load">Обновить</UiButton>
        <UiButton
          v-if="groups.length > 1"
          size="sm"
          :loading="mergingAll"
          :disabled="loading"
          @click="mergeAll"
        >
          Склеить все ({{ totals.groups }})
        </UiButton>
      </div>
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>
    <UiSkeleton v-if="loading && !groups.length" :lines="6" height="20px" />

    <UiEmpty
      v-else-if="!groups.length && !loadError"
      icon="box"
      title="Дублей нет"
      description="Одноимённых категорий под одним родителем не найдено."
    />

    <ul v-else class="dup-list">
      <li v-for="group in groups" :key="groupId(group)" class="dup-group">
        <div class="dup-title">
          <strong>{{ group.name }}</strong>
          <span class="dup-parent">в «{{ group.parent?.name ?? 'корень каталога' }}»</span>
          <UiBadge tone="warning" size="sm">×{{ group.categories.length }}</UiBadge>
        </div>
        <fieldset class="dup-options" :disabled="busy.has(groupId(group)) || mergingAll">
          <legend class="sr-only">Какая категория останется</legend>
          <label v-for="category in group.categories" :key="category.id" class="dup-option">
            <input v-model="targets[groupId(group)]" type="radio" :name="groupId(group)" :value="category.id">
            <code>/{{ category.slug }}</code>
            <span class="dup-meta">
              {{ category.productCount }} тов.<template v-if="category.childCount"> · {{ category.childCount }} подкат.</template>
            </span>
            <UiBadge v-if="!category.isVisible" tone="neutral" size="sm">скрыта</UiBadge>
          </label>
        </fieldset>
        <UiButton
          size="sm"
          variant="secondary"
          :loading="busy.has(groupId(group))"
          :disabled="mergingAll"
          @click="mergeOne(group)"
        >
          Склеить в выбранную
        </UiButton>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.duplicates {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.dup-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.dup-head p {
  max-width: 70ch;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.dup-actions {
  display: flex;
  gap: var(--space-2);
}

.dup-list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  list-style: none;
}

.dup-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  gap: var(--space-3);
}

.dup-group:last-child {
  border-bottom: 0;
}

.dup-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  flex-basis: 100%;
}

.dup-parent,
.dup-meta {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.dup-options {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  border: 0;
  gap: var(--space-1);
  min-width: 0;
  flex: 1 1 320px;
}

.dup-option {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  cursor: pointer;
}

.dup-option code {
  overflow-wrap: anywhere;
}

.sr-only {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
