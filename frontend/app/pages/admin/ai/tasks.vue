<script setup lang="ts">
import type { Pagination, Paginated } from '~/types/api'
import type { AiEntity, AiPrompt, AiTask, AiTaskItem, AiTaskItemStatus } from '~/types/ai'
import { AI_ITEM_STATUS, AI_TASK_STATUS } from '~/types/ai'

definePageMeta({ layout: 'admin' })

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()
const { status, loadStatus } = useAiStatus()
const route = useRoute()
const router = useRouter()

const tab = ref(route.query.tab === 'prompts' ? 'prompts' : 'tasks')
watch(tab, (value) => router.replace({ query: { ...route.query, tab: value === 'tasks' ? undefined : value } }))

/* ---- Tasks ------------------------------------------------------------- */
const entityFilter = ref('')

const {
  rows: tasks,
  pagination,
  loading,
  error: loadError,
  load: loadTasks,
  setPage,
} = useAdminList<AiTask>('/ai/tasks', {
  params: () => ({ entity: entityFilter.value }),
  limit: 25,
  errorText: 'Не удалось загрузить задачи',
})

const hasActive = computed(() => tasks.value.some(task => task.status === 'QUEUED' || task.status === 'RUNNING'))

// The runner works once a minute; poll while something is in flight.
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void loadStatus()
  void loadPrompts()
  poll = setInterval(() => {
    if (!hasActive.value) return
    void loadTasks()
    if (detail.value) void refreshDetail()
  }, 10_000)
})
onBeforeUnmount(() => clearInterval(poll))

const { run, busy } = useAdminAction()

/** Resolves to the result, or `undefined` when it failed (already toasted). */
function action(task: AiTask, path: string, done: string, body?: Record<string, unknown>) {
  return run(
    () => adminFetch<{ reverted?: number, skippedFields?: number }>(
      `/ai/tasks/${task.id}/${path}`,
      { method: 'POST', body },
    ),
    {
      key: `${task.id}:${path}`,
      error: 'Не удалось выполнить действие',
      success: result => path === 'revert' && result?.reverted != null
        ? `Откачено записей: ${result.reverted}${result.skippedFields ? `, полей пропущено (изменены позже): ${result.skippedFields}` : ''}`
        : done,
      after: async () => {
        await loadTasks()
        if (detail.value?.id === task.id) await refreshDetail()
      },
    },
  )
}

const confirmRevert = ref<AiTask | null>(null)
const confirmDelete = ref<AiTask | null>(null)

/** The dialog closes on success only — on failure it stays up to retry. */
async function revertTask() {
  const task = confirmRevert.value
  if (!task) return
  if (await action(task, 'revert', 'Откачено')) confirmRevert.value = null
}

async function removeTask() {
  const task = confirmDelete.value
  if (!task) return
  const done = await run(() => adminFetch(`/ai/tasks/${task.id}`, { method: 'DELETE' }), {
    key: `${task.id}:delete`,
    error: 'Не удалось удалить задачу',
    success: 'Задача удалена',
    after: loadTasks,
  })
  if (done === undefined) return
  confirmDelete.value = null
  if (detail.value?.id === task.id) detail.value = null
}

/* ---- Reschedule -------------------------------------------------------- */
const rescheduling = ref<AiTask | null>(null)
const rescheduleAt = ref('')

function openReschedule(task: AiTask) {
  rescheduling.value = task
  rescheduleAt.value = ''
}

async function submitReschedule() {
  const task = rescheduling.value
  if (!task) return
  const done = await action(task, 'resume', 'Задача поставлена в очередь', {
    scheduledAt: fromLocalInput(rescheduleAt.value) ?? undefined,
  })
  if (done) rescheduling.value = null
}

/* ---- Detail ------------------------------------------------------------ */
const detail = ref<AiTask | null>(null)
const items = ref<AiTaskItem[]>([])
const itemsPagination = ref<Pagination>({ page: 1, limit: 50, total: 0, pages: 0 })
const itemsPage = ref(1)
const itemStatus = ref('')
const itemsLoading = ref(false)
let detailTicket = 0

const detailOpen = computed({
  get: () => Boolean(detail.value),
  set: (value) => {
    if (!value) detail.value = null
  },
})

/**
 * Page and status tab are changed only through these, each followed by one
 * refresh — they used to be watched as well, so opening a task or switching
 * a tab on page > 1 loaded the items two or three times.
 */
function openDetail(task: AiTask) {
  detail.value = task
  // The previous task's rows must not show under this one's title.
  items.value = []
  itemsPage.value = 1
  itemStatus.value = ''
  return refreshDetail()
}

function setItemsPage(next: number) {
  itemsPage.value = next
  return refreshDetail()
}

function setItemStatus(next: string | number) {
  itemStatus.value = String(next)
  itemsPage.value = 1
  return refreshDetail()
}

async function refreshDetail() {
  if (!detail.value) return
  const id = detail.value.id
  const ticket = ++detailTicket
  itemsLoading.value = !items.value.length
  try {
    const [task, response] = await Promise.all([
      adminFetch<AiTask>(`/ai/tasks/${id}`),
      adminFetch<Paginated<AiTaskItem>>(`/ai/tasks/${id}/items`, {
        params: compactParams({ page: itemsPage.value, status: itemStatus.value }),
      }),
    ])
    if (ticket !== detailTicket || detail.value?.id !== id) return
    detail.value = task
    items.value = response.data
    itemsPagination.value = response.pagination
  } catch (error) {
    if (ticket === detailTicket) toast.error(errorMessage(error, 'Не удалось загрузить задачу'))
  } finally {
    if (ticket === detailTicket) itemsLoading.value = false
  }
}

const itemTabs = computed(() => {
  const counts = detail.value?.counts ?? {}
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0)
  return [
    { value: '', label: 'Все', count: total },
    ...(Object.keys(AI_ITEM_STATUS) as AiTaskItemStatus[]).map(key => ({
      value: key,
      label: AI_ITEM_STATUS[key].label,
      count: counts[key] ?? 0,
    })),
  ]
})

const revertItem = (item: AiTaskItem) =>
  run(() => adminFetch(`/ai/tasks/${item.taskId}/items/${item.id}/revert`, { method: 'POST' }), {
    key: `item:${item.id}`,
    error: 'Не удалось откатить',
    success: 'Изменения откачены',
    after: async () => {
      await refreshDetail()
      await loadTasks()
    },
  })

/* ---- Prompts ----------------------------------------------------------- */
const prompts = ref<AiPrompt[]>([])
const promptEditor = ref(false)
const editingPrompt = ref<AiPrompt | null>(null)
const promptForm = reactive({ name: '', entity: 'PRODUCT' as AiEntity, text: '' })
const promptError = ref('')
const promptSaving = ref(false)

async function loadPrompts() {
  prompts.value = await adminFetch<AiPrompt[]>('/ai/prompts').catch(() => [])
}

function openPrompt(prompt: AiPrompt | null) {
  editingPrompt.value = prompt
  Object.assign(promptForm, prompt
    ? { name: prompt.name, entity: prompt.entity, text: prompt.text }
    : { name: '', entity: 'PRODUCT', text: '' })
  promptError.value = ''
  promptEditor.value = true
}

async function savePrompt() {
  if (!promptForm.name.trim() || !promptForm.text.trim()) {
    promptError.value = 'Заполните название и текст'
    return
  }
  promptError.value = ''
  promptSaving.value = true
  try {
    if (editingPrompt.value) {
      await adminFetch(`/ai/prompts/${editingPrompt.value.id}`, {
        method: 'PATCH',
        body: { name: promptForm.name, text: promptForm.text },
      })
    } else {
      await adminFetch('/ai/prompts', { method: 'POST', body: { ...promptForm } })
    }
    promptEditor.value = false
    toast.success('Промпт сохранён')
    await loadPrompts()
  } catch (error) {
    promptError.value = errorMessage(error, 'Не удалось сохранить промпт')
  } finally {
    promptSaving.value = false
  }
}

const deletePrompt = (prompt: AiPrompt) =>
  run(() => adminFetch(`/ai/prompts/${prompt.id}`, { method: 'DELETE' }), {
    key: `prompt:${prompt.id}`,
    error: 'Не удалось удалить промпт',
    success: 'Промпт удалён',
    after: loadPrompts,
  })

/* ---- Display ----------------------------------------------------------- */
const ENTITY_LABEL: Record<AiEntity, string> = { PRODUCT: 'Товары', CATEGORY: 'Категории' }

function fieldLabel(entity: AiEntity, key: string) {
  return status.value?.fields[entity]?.find((f) => f.key === key)?.label ?? key
}

const percent = (task: AiTask) => (task.total ? Math.round((task.processed / task.total) * 100) : 0)

function waitingNote(task: AiTask) {
  const now = Date.now()
  if (task.status === 'QUEUED' && new Date(task.scheduledAt).getTime() > now) {
    return `Старт ${formatDateTime(task.scheduledAt)}`
  }
  if (task.pausedUntil && new Date(task.pausedUntil).getTime() > now) {
    return `Лимит модели — продолжит ${formatDateTime(task.pausedUntil)}`
  }
  return ''
}

const isBusy = (task: AiTask, path: string) => busy.value === `${task.id}:${path}`
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="ИИ · Задачи"
      description="Планировщик проверяет очередь раз в минуту и обрабатывает задачи по одной"
    >
      <UiButton variant="secondary" to="/admin/ai/products">Выбрать товары</UiButton>
      <UiButton variant="secondary" to="/admin/ai/categories">Выбрать категории</UiButton>
    </AdminPageHead>

    <AdminAiStatusLine :status="status" />

    <UiTabs
      v-model="tab"
      :tabs="[
        { value: 'tasks', label: 'Задачи', count: pagination.total },
        { value: 'prompts', label: 'Промпты', count: prompts.length }
      ]"
    />

    <!-- Tasks -->
    <template v-if="tab === 'tasks'">
      <div class="toolbar">
        <UiSelect
          v-model="entityFilter"
          size="sm"
          :options="[
            { value: '', label: 'Товары и категории' },
            { value: 'PRODUCT', label: 'Товары' },
            { value: 'CATEGORY', label: 'Категории' }
          ]"
        />
        <UiButton size="sm" variant="ghost" @click="loadTasks()">Обновить</UiButton>
      </div>

      <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

      <!-- Skeleton on the first load only: the 10 s poll must not blank the list. -->
      <div v-if="loading && !tasks.length" class="list">
        <UiSkeleton v-for="i in 3" :key="i" height="120px" radius="var(--radius-md)" />
      </div>

      <UiEmpty
        v-else-if="!tasks.length"
        icon="box"
        title="Задач пока нет"
        description="Откройте «ИИ · Товары» или «ИИ · Категории», выберите записи и создайте задачу."
      />

      <ul v-else class="list">
        <li v-for="task in tasks" :key="task.id" class="task">
          <div class="task-head">
            <button type="button" class="task-name" @click="openDetail(task)">{{ task.name }}</button>
            <UiBadge size="sm">{{ ENTITY_LABEL[task.entity] }}</UiBadge>
            <UiBadge size="sm" :tone="AI_TASK_STATUS[task.status].tone" dot>{{ AI_TASK_STATUS[task.status].label }}</UiBadge>
            <span v-if="waitingNote(task)" class="admin-muted">{{ waitingNote(task) }}</span>
          </div>

          <div class="progress" :aria-label="`${percent(task)}%`">
            <span :style="{ width: `${percent(task)}%` }" />
          </div>

          <div class="facts">
            <span>{{ task.processed }} / {{ task.total }}</span>
            <span class="ok">обновлено {{ task.applied }}</span>
            <span v-if="task.failed" class="bad">ошибок {{ task.failed }}</span>
            <span>поля: {{ task.fields.map((f) => fieldLabel(task.entity, f)).join(', ') }}</span>
            <span>модель: <code>{{ task.model }}</code></span>
            <span>создана {{ formatDateTime(task.createdAt) }}<template v-if="task.createdBy"> · {{ task.createdBy }}</template></span>
          </div>

          <p v-if="task.lastError && task.status !== 'DONE'" class="error">{{ task.lastError }}</p>

          <div class="actions">
            <UiButton size="sm" variant="ghost" @click="openDetail(task)">Результаты</UiButton>
            <UiButton
              v-if="task.status === 'QUEUED' || task.status === 'RUNNING'"
              size="sm"
              variant="ghost"
              :loading="isBusy(task, 'pause')"
              @click="action(task, 'pause', 'Задача приостановлена')"
            >
              Пауза
            </UiButton>
            <UiButton
              v-if="task.status === 'PAUSED' || (task.status === 'QUEUED' && waitingNote(task))"
              size="sm"
              variant="ghost"
              :loading="isBusy(task, 'resume')"
              @click="action(task, 'resume', 'Задача запущена')"
            >
              Запустить сейчас
            </UiButton>
            <UiButton
              v-if="task.status !== 'CANCELLED' && task.processed < task.total"
              size="sm"
              variant="ghost"
              @click="openReschedule(task)"
            >
              Запланировать
            </UiButton>
            <UiButton
              v-if="task.failed"
              size="sm"
              variant="ghost"
              :loading="isBusy(task, 'retry-failed')"
              @click="action(task, 'retry-failed', 'Ошибочные записи снова в очереди')"
            >
              Повторить ошибки
            </UiButton>
            <UiButton
              v-if="task.applied"
              size="sm"
              variant="ghost"
              @click="confirmRevert = task"
            >
              Откатить
            </UiButton>
            <UiButton
              v-if="task.status === 'QUEUED' || task.status === 'PAUSED'"
              size="sm"
              variant="ghost"
              :loading="isBusy(task, 'cancel')"
              @click="action(task, 'cancel', 'Задача отменена')"
            >
              Отменить
            </UiButton>
            <UiButton
              v-if="task.status !== 'RUNNING'"
              size="sm"
              variant="ghost"
              @click="confirmDelete = task"
            >
              Удалить
            </UiButton>
          </div>
        </li>
      </ul>

      <UiPagination
        :page="pagination.page"
        :pages="pagination.pages"
        :total="pagination.total"
        @change="setPage"
      />
    </template>

    <!-- Prompts -->
    <template v-else>
      <div class="toolbar">
        <span class="admin-muted">Шаблоны подставляются в мастер задачи; задача хранит свою копию текста</span>
        <UiButton size="sm" @click="openPrompt(null)">Новый промпт</UiButton>
      </div>
      <UiEmpty
        v-if="!prompts.length"
        icon="box"
        title="Промптов пока нет"
        description="Сохраните промпт здесь или галочкой в мастере задачи."
      />
      <ul v-else class="list">
        <li v-for="prompt in prompts" :key="prompt.id" class="task">
          <div class="task-head">
            <strong>{{ prompt.name }}</strong>
            <UiBadge size="sm">{{ ENTITY_LABEL[prompt.entity] }}</UiBadge>
          </div>
          <p class="prompt-text">{{ prompt.text }}</p>
          <div class="actions">
            <UiButton size="sm" variant="ghost" @click="openPrompt(prompt)">Изменить</UiButton>
            <UiButton
              size="sm"
              variant="ghost"
              :loading="busy === `prompt:${prompt.id}`"
              @click="deletePrompt(prompt)"
            >
              Удалить
            </UiButton>
          </div>
        </li>
      </ul>
    </template>

    <!-- Detail -->
    <UiModal v-model:open="detailOpen" :title="detail?.name" size="xl">
      <template v-if="detail">
        <div class="detail-head">
          <UiBadge size="sm" :tone="AI_TASK_STATUS[detail.status].tone" dot>{{ AI_TASK_STATUS[detail.status].label }}</UiBadge>
          <span class="admin-muted">{{ detail.processed }} / {{ detail.total }} · модель {{ detail.model }} · по {{ detail.batchSize }} в запросе</span>
        </div>
        <details class="prompt-box">
          <summary>Промпт{{ detail.prompt ? ` «${detail.prompt.name}»` : '' }}</summary>
          <p class="prompt-text">{{ detail.promptText }}</p>
        </details>

        <UiTabs :model-value="itemStatus" :tabs="itemTabs" @update:model-value="setItemStatus" />

        <UiSkeleton v-if="itemsLoading" :lines="5" height="18px" />
        <UiEmpty v-else-if="!items.length" icon="box" title="Записей нет" />
        <ul v-else class="items">
          <li v-for="item in items" :key="item.id" class="item">
            <div class="item-head">
              <strong>{{ item.entityName }}</strong>
              <UiBadge size="sm" :tone="AI_ITEM_STATUS[item.status].tone">{{ AI_ITEM_STATUS[item.status].label }}</UiBadge>
              <span v-if="item.attempts > 1" class="admin-muted">попыток: {{ item.attempts }}</span>
              <UiButton
                v-if="item.status === 'APPLIED'"
                size="sm"
                variant="ghost"
                :loading="busy === `item:${item.id}`"
                @click="revertItem(item)"
              >
                Откатить
              </UiButton>
            </div>
            <p v-if="item.error" class="error">{{ item.error }}</p>
            <div v-for="(change, key) in item.changes ?? {}" :key="key" class="diff-row">
              <span class="diff-label">{{ fieldLabel(detail.entity, String(key)) }}</span>
              <del>{{ change.old || '—' }}</del>
              <ins>{{ change.new }}</ins>
            </div>
          </li>
        </ul>

        <UiPagination
          :page="itemsPage"
          :pages="itemsPagination.pages"
          :total="itemsPagination.total"
          @change="setItemsPage"
        />
      </template>
    </UiModal>

    <!-- Reschedule -->
    <UiModal :open="Boolean(rescheduling)" title="Запланировать задачу" size="sm" @update:open="rescheduling = null">
      <UiField label="Время запуска" hint="Пусто — в течение минуты" for="ai-resched">
        <UiInput id="ai-resched" v-model="rescheduleAt" type="datetime-local" />
      </UiField>
      <template #footer>
        <UiButton variant="ghost" @click="rescheduling = null">Отмена</UiButton>
        <UiButton
          :loading="rescheduling ? isBusy(rescheduling, 'resume') : false"
          @click="submitReschedule"
        >
          Поставить в очередь
        </UiButton>
      </template>
    </UiModal>

    <!-- Revert -->
    <UiConfirm
      :open="Boolean(confirmRevert)"
      title="Откатить задачу?"
      confirm-label="Откатить"
      :busy="confirmRevert ? isBusy(confirmRevert, 'revert') : false"
      @update:open="confirmRevert = null"
      @confirm="revertTask"
    >
      Обновлённые поля ({{ confirmRevert?.applied }} записей) вернутся к прежним значениям. Поле, которое
      после задачи уже кто-то изменил, останется как есть. Закрепление от перепарсинга снимается.
    </UiConfirm>

    <!-- Delete -->
    <UiConfirm
      :open="Boolean(confirmDelete)"
      title="Удалить задачу?"
      :busy="confirmDelete ? isBusy(confirmDelete, 'delete') : false"
      @update:open="confirmDelete = null"
      @confirm="removeTask"
    >
      История и возможность отката пропадут. Уже внесённые изменения в товарах и категориях останутся.
    </UiConfirm>

    <!-- Prompt editor -->
    <UiModal v-model:open="promptEditor" :title="editingPrompt ? 'Промпт' : 'Новый промпт'" size="md">
      <UiAlert v-if="promptError" tone="danger" class="block">{{ promptError }}</UiAlert>
      <div class="admin-form">
        <UiField label="Название" required for="pr-name">
          <UiInput id="pr-name" v-model="promptForm.name" />
        </UiField>
        <UiField label="Для" for="pr-entity">
          <UiSelect
            id="pr-entity"
            v-model="promptForm.entity"
            :disabled="Boolean(editingPrompt)"
            :options="[
              { value: 'PRODUCT', label: 'Товаров' },
              { value: 'CATEGORY', label: 'Категорий' }
            ]"
          />
        </UiField>
        <UiField label="Текст" required for="pr-text">
          <UiTextarea id="pr-text" v-model="promptForm.text" :rows="8" />
        </UiField>
      </div>
      <template #footer>
        <UiButton variant="ghost" @click="promptEditor = false">Отмена</UiButton>
        <UiButton :loading="promptSaving" @click="savePrompt">Сохранить</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.admin-muted {
  font-size: var(--text-sm);
}

.toolbar,
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.toolbar {
  justify-content: space-between;
}

.list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-3);
  list-style: none;
}

.task {
  display: flex;
  flex-direction: column;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-3);
}

.task-head,
.detail-head,
.item-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.task-name {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-strong);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-lg);
  font-weight: 700;
  text-align: left;
}

.task-name:hover {
  color: var(--brand);
}

.progress {
  overflow: hidden;
  height: 6px;
  border-radius: 999px;
  background: var(--surface-sunken);
}

.progress span {
  display: block;
  height: 100%;
  background: var(--brand);
  transition: width var(--duration-fast) var(--ease-out);
}

.facts {
  display: flex;
  flex-wrap: wrap;
  color: var(--text-muted);
  font-size: var(--text-xs);
  gap: var(--space-1) var(--space-4);
}

.facts code {
  font-family: var(--font-mono);
}

.ok {
  color: var(--success-soft-text);
}

.bad,
.error {
  color: var(--danger);
}

.error {
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}

.prompt-text {
  color: var(--text-default);
  font-size: var(--text-sm);
  white-space: pre-wrap;
}

.prompt-box {
  margin: var(--space-3) 0;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.prompt-box summary {
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 600;
}

.items {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: var(--space-3) 0;
  gap: var(--space-3);
  list-style: none;
}

.item {
  display: flex;
  flex-direction: column;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  gap: var(--space-2);
}

.item-head > :last-child:is(button, a) {
  margin-left: auto;
}

.diff-row {
  display: grid;
  grid-template-columns: 140px 1fr 1fr;
  font-size: var(--text-sm);
  gap: var(--space-3);
}

.diff-label {
  color: var(--text-muted);
  font-weight: 600;
}

.diff-row del {
  color: var(--text-muted);
  white-space: pre-wrap;
}

.diff-row ins {
  color: var(--text-strong);
  text-decoration: none;
  white-space: pre-wrap;
}

.block {
  margin-bottom: var(--space-4);
}

@media (max-width: 760px) {
  .diff-row {
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }
}
</style>
