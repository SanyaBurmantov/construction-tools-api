<script setup lang="ts">
/**
 * «Планы»: the project's goals and to-do list (backend `plans/`). A goal can
 * be measured by a number the site counts itself (orders, revenue, visits…),
 * a task can belong to a goal, and both carry screenshots.
 */
import type { PlanItem, PlanKind, PlanMetric, PlansResponse } from '~/types/api'

definePageMeta({ layout: 'admin' })

const { adminFetch } = useAdminApi()
const { run, busy } = useAdminAction()

const items = ref<PlanItem[]>([])
const metrics = ref<PlanMetric[]>([])
const loading = ref(true)
const loadError = ref('')

const tab = ref<'open' | 'done' | 'all'>('open')
const area = ref<string>('')
const goalFilter = ref<string>('')
const showDoneGoals = ref(false)

const editorOpen = ref(false)
const editing = ref<PlanItem | null>(null)
const newKind = ref<PlanKind>('TASK')
const newGoalId = ref<string | null>(null)

async function load(silent = false) {
  if (!silent) loading.value = true
  loadError.value = ''
  try {
    const data = await adminFetch<PlansResponse>('/plans')
    items.value = data.items
    metrics.value = data.metrics
    if (editing.value) editing.value = data.items.find(i => i.id === editing.value!.id) ?? null
  }
  catch {
    loadError.value = 'Не удалось загрузить планы'
  }
  finally {
    loading.value = false
  }
}

const goals = computed(() => items.value.filter(i => i.kind === 'GOAL'))
const openGoals = computed(() => goals.value.filter(isPlanOpen))
const closedGoals = computed(() => goals.value.filter(g => !isPlanOpen(g)))
const tasks = computed(() => items.value.filter(i => i.kind === 'TASK'))
const goalTitle = (id: string | null) => (id ? goals.value.find(g => g.id === id)?.title : undefined)
const metricOf = (key: string | null) => metrics.value.find(m => m.key === key)

const filteredTasks = computed(() => tasks.value.filter(t =>
  (!area.value || t.area === area.value)
  && (!goalFilter.value || (goalFilter.value === 'none' ? !t.goalId : t.goalId === goalFilter.value))))
const visibleTasks = computed(() => filteredTasks.value.filter(t =>
  tab.value === 'all' || (tab.value === 'open' ? isPlanOpen(t) : !isPlanOpen(t))))
const tabs = computed(() => [
  { value: 'open', label: 'Активные', count: filteredTasks.value.filter(isPlanOpen).length },
  { value: 'done', label: 'Сделано и отменено', count: filteredTasks.value.filter(t => !isPlanOpen(t)).length },
  { value: 'all', label: 'Все', count: filteredTasks.value.length },
])
const overdueCount = computed(() => tasks.value.filter(t => isPlanOverdue(t)).length)

const areaFilterOptions = [{ value: '', label: 'Все направления' }, ...planAreaOptions]
const goalFilterOptions = computed(() => [
  { value: '', label: 'Все цели' },
  { value: 'none', label: 'Без цели' },
  ...goals.value.map(g => ({ value: g.id, label: g.title })),
])

function openNew(kind: PlanKind, goalId: string | null = null) {
  editing.value = null
  newKind.value = kind
  newGoalId.value = goalId
  editorOpen.value = true
}

function openItem(item: PlanItem) {
  editing.value = item
  editorOpen.value = true
}

async function toggleDone(task: PlanItem) {
  const status = task.status === 'DONE' ? 'TODO' : 'DONE'
  await run(() => adminFetch(`/plans/${task.id}`, { method: 'PATCH', body: { status } }), {
    error: 'Не удалось отметить',
    success: status === 'DONE' ? `Сделано: «${task.title}»` : 'Вернул в работу',
    key: task.id,
    after: () => load(true),
  })
}

function goalProgressLabel(goal: PlanItem) {
  const metric = metricOf(goal.metric)
  if (!metric) return null
  if (goal.target == null) return formatPlanValue(goal.value, metric.unit)
  return `${formatPlanValue(goal.value)} из ${formatPlanValue(goal.target, metric.unit)}`
}

onMounted(() => load())
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="Планы и цели"
      description="Куда идём и что для этого сделать. У цели может быть число, которое сайт считает сам — заказы, выручка, визиты, — у задачи срок, исполнитель и скриншоты."
    >
      <UiButton variant="secondary" size="sm" @click="openNew('GOAL')">Новая цель</UiButton>
      <UiButton size="sm" @click="openNew('TASK')">Новая задача</UiButton>
    </AdminPageHead>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>
    <UiSkeleton v-else-if="loading && !items.length" height="240px" radius="var(--radius-md)" />

    <template v-else>
      <section class="block">
        <h2 class="block-title">Цели</h2>
        <UiEmpty v-if="!openGoals.length" title="Целей пока нет" description="Например: «10 заказов в месяц» — прогресс посчитается сам.">
          <UiButton size="sm" @click="openNew('GOAL')">Добавить цель</UiButton>
        </UiEmpty>
        <div v-else class="goals">
          <article v-for="goal in openGoals" :key="goal.id" class="goal" @click="openItem(goal)">
            <div class="goal-top">
              <UiBadge size="sm">{{ PLAN_AREA_LABELS[goal.area] }}</UiBadge>
              <UiBadge v-if="goal.priority === 1" size="sm" tone="warning">Важно</UiBadge>
              <span v-if="goal.dueDate" class="goal-due" :class="{ overdue: isPlanOverdue(goal) }">до {{ formatDay(goal.dueDate) }}</span>
            </div>
            <h3 class="goal-title">{{ goal.title }}</h3>
            <template v-if="goal.metric">
              <div
                class="meter"
                role="meter"
                :aria-valuenow="goal.value ?? 0"
                :aria-valuemin="0"
                :aria-valuemax="goal.target ?? undefined"
                :aria-label="metricOf(goal.metric)?.label"
              >
                <div class="meter-fill" :style="{ width: `${Math.round((goal.progress ?? 0) * 100)}%` }" />
              </div>
              <p class="goal-measure">
                <strong>{{ goalProgressLabel(goal) }}</strong>
                <span v-if="goal.progress != null" class="admin-muted"> · {{ Math.round(goal.progress * 100) }}%</span>
              </p>
              <p class="admin-muted small">{{ metricOf(goal.metric)?.label }}</p>
            </template>
            <p v-else-if="goal.description" class="admin-muted small clamp">{{ goal.description }}</p>
            <div class="goal-bottom">
              <span class="admin-muted small">
                Задачи: {{ goal.tasksDone }} из {{ goal.tasksTotal }}
              </span>
              <UiButton variant="link" size="sm" @click.stop="openNew('TASK', goal.id)">+ задача</UiButton>
            </div>
          </article>
        </div>
        <div v-if="closedGoals.length" class="closed-goals">
          <UiButton variant="link" size="sm" @click="showDoneGoals = !showDoneGoals">
            {{ showDoneGoals ? 'Скрыть' : 'Показать' }} достигнутые и отменённые ({{ closedGoals.length }})
          </UiButton>
          <ul v-if="showDoneGoals" class="closed-list">
            <li v-for="goal in closedGoals" :key="goal.id">
              <button type="button" class="link-row" @click="openItem(goal)">
                {{ goal.title }}
                <span class="admin-muted"> — {{ PLAN_STATUS_LABELS[goal.status].toLowerCase() }}<template v-if="goal.doneAt"> {{ formatDay(goal.doneAt) }}</template></span>
              </button>
            </li>
          </ul>
        </div>
      </section>

      <section class="block">
        <div class="tasks-head">
          <h2 class="block-title">
            Задачи
            <UiBadge v-if="overdueCount" size="sm" tone="danger">просрочено: {{ overdueCount }}</UiBadge>
          </h2>
          <div class="filters">
            <UiSelect v-model="area" size="sm" :options="areaFilterOptions" aria-label="Направление" />
            <UiSelect v-model="goalFilter" size="sm" :options="goalFilterOptions" aria-label="Цель" />
          </div>
        </div>
        <UiTabs v-model="tab" :tabs="tabs" />

        <UiEmpty
          v-if="!visibleTasks.length"
          :title="tab === 'open' ? 'Активных задач нет' : 'Здесь пусто'"
          description="Новая задача — кнопкой вверху или «+ задача» на карточке цели."
        />
        <ul v-else class="tasks">
          <li
            v-for="task in visibleTasks"
            :key="task.id"
            class="task"
            :class="{ 'is-closed': !isPlanOpen(task) }"
          >
            <button
              type="button"
              class="check"
              :class="{ 'is-done': task.status === 'DONE' }"
              :disabled="busy === task.id"
              :aria-label="task.status === 'DONE' ? 'Вернуть в работу' : 'Отметить сделанным'"
              :aria-pressed="task.status === 'DONE'"
              @click="toggleDone(task)"
            >
              <UiIcon v-if="task.status === 'DONE'" name="check" :size="14" />
            </button>
            <button type="button" class="task-body" @click="openItem(task)">
              <span class="task-title">{{ task.title }}</span>
              <span v-if="task.description" class="task-desc">{{ task.description }}</span>
              <span class="task-meta">
                <UiBadge v-if="task.status === 'IN_PROGRESS'" size="sm" tone="info">в работе</UiBadge>
                <UiBadge v-if="task.status === 'DROPPED'" size="sm">отменено</UiBadge>
                <UiBadge v-if="task.priority === 1 && isPlanOpen(task)" size="sm" tone="warning">важно</UiBadge>
                <span>{{ PLAN_AREA_LABELS[task.area] }}</span>
                <span v-if="task.dueDate" :class="{ overdue: isPlanOverdue(task) }">
                  {{ isPlanOverdue(task) ? 'просрочено, ' : '' }}до {{ formatDay(task.dueDate) }}
                </span>
                <span v-if="task.assignee">{{ task.assignee }}</span>
                <span v-if="task.attachments?.length" class="clip">
                  <UiIcon name="upload" :size="12" /> {{ task.attachments.length }}
                </span>
                <span v-if="goalTitle(task.goalId)" class="goal-ref">→ {{ goalTitle(task.goalId) }}</span>
              </span>
            </button>
          </li>
        </ul>
      </section>
    </template>

    <AdminPlansPlanEditor
      v-model:open="editorOpen"
      :item="editing"
      :kind="newKind"
      :default-goal-id="newGoalId"
      :goals="goals"
      :metrics="metrics"
      @saved="load(true)"
      @deleted="load(true)"
    />
  </div>
</template>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.block-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-strong);
  font-size: var(--text-lg, 18px);
  font-weight: 700;
}

.goals {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-3);
}

.goal {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.goal:hover {
  border-color: var(--border-default);
  box-shadow: 0 2px 8px rgb(0 0 0 / 6%);
}

.goal-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.goal-due {
  margin-left: auto;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.goal-title {
  color: var(--text-strong);
  font-size: var(--text-md, 15px);
  font-weight: 600;
  line-height: 1.35;
}

.meter {
  overflow: hidden;
  height: 8px;
  border-radius: 4px;
  background: var(--surface-sunken);
}

.meter-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--brand);
  transition: width 0.3s;
}

.goal-measure {
  color: var(--text-strong);
}

.goal-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: var(--space-1);
}

.small {
  font-size: var(--text-sm);
}

.clamp {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.closed-list {
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}

.link-row {
  padding: var(--space-1) 0;
  border: 0;
  background: none;
  color: var(--text-strong);
  cursor: pointer;
  text-align: left;
}

.tasks-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.filters > * {
  min-width: 190px;
}

.tasks {
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  list-style: none;
}

.task {
  display: flex;
  min-width: 0;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-3) var(--space-4);
}

.task + .task {
  border-top: 1px solid var(--border-subtle);
}

.check {
  display: grid;
  flex: none;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  padding: 0;
  border: 2px solid var(--border-default);
  border-radius: 50%;
  background: var(--surface-card);
  color: #fff;
  cursor: pointer;
  place-items: center;
}

.check:hover {
  border-color: var(--success);
}

.check.is-done {
  border-color: var(--success);
  background: var(--success);
}

.task-body {
  display: flex;
  overflow: hidden;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.task-title {
  color: var(--text-strong);
  font-weight: 600;
}

.is-closed .task-title {
  color: var(--text-muted);
  text-decoration: line-through;
}

.task-desc {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.overdue {
  color: var(--danger);
  font-weight: 600;
}

.clip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.goal-ref {
  overflow: hidden;
  max-width: 280px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .filters,
  .filters > * {
    width: 100%;
  }

  .task {
    padding: var(--space-3);
  }
}
</style>
