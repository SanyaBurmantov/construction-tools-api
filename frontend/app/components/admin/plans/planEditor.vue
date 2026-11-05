<script setup lang="ts">
/**
 * One goal or task of «Планы»: a modal form. Screenshots are uploaded to our
 * S3 (`POST /admin/media/upload?kind=screenshot`) from the button, a drop or
 * a paste (Ctrl+V while the form is open). On an existing item an attachment
 * is saved at once — closing the form must not lose a screenshot; on a new
 * one it goes with «Создать».
 */
import type { PlanAttachment, PlanItem, PlanKind, PlanMetric } from '~/types/api'

const props = defineProps<{
  /** The item being edited; null creates a new one of `kind`. */
  item: PlanItem | null
  kind: PlanKind
  goals: PlanItem[]
  metrics: PlanMetric[]
  /** A new task created from a goal's card starts linked to it. */
  defaultGoalId?: string | null
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [], deleted: [] }>()

const { adminFetch, errorMessage } = useAdminApi()
const { run, busy } = useAdminAction()
const toast = useAppToast()

type Form = {
  kind: PlanKind
  title: string
  description: string
  status: string
  area: string
  priority: number
  dueDate: string
  assignee: string
  metric: string
  target: string | number | null
  goalId: string
  attachments: PlanAttachment[]
}

const form = reactive<Form>(blank())
const titleError = ref('')
const uploading = ref(0)
const confirmDelete = ref(false)
const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function blank(): Form {
  return {
    kind: props.kind,
    title: '',
    description: '',
    status: 'TODO',
    area: 'OTHER',
    priority: 2,
    dueDate: '',
    assignee: '',
    metric: '',
    target: null,
    goalId: props.defaultGoalId ?? '',
    attachments: [],
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  titleError.value = ''
  const item = props.item
  Object.assign(form, item
    ? {
        kind: item.kind,
        title: item.title,
        description: item.description ?? '',
        status: item.status,
        area: item.area,
        priority: item.priority,
        dueDate: item.dueDate?.slice(0, 10) ?? '',
        assignee: item.assignee ?? '',
        metric: item.metric ?? '',
        target: item.target,
        goalId: item.goalId ?? '',
        attachments: [...(item.attachments ?? [])],
      }
    : blank())
}, { immediate: true })

const isGoal = computed(() => form.kind === 'GOAL')
const heading = computed(() => {
  if (props.item) return isGoal.value ? 'Цель' : 'Задача'
  return isGoal.value ? 'Новая цель' : 'Новая задача'
})
const goalOptions = computed(() => [
  { value: '', label: 'Без цели' },
  ...props.goals.filter(g => g.id !== props.item?.id).map(g => ({ value: g.id, label: g.title })),
])
const metricOptions = computed(() => [
  { value: '', label: 'Без измерения — отмечу вручную' },
  ...props.metrics.map(m => ({ value: m.key, label: `${m.label}, ${m.unit === 'BYN' ? 'Br' : m.unit}` })),
])
const kindOptions = [
  { value: 'TASK', label: 'Задача' },
  { value: 'GOAL', label: 'Цель' },
]

function payload() {
  const target = form.target === '' || form.target == null ? null : Number(form.target)
  return {
    kind: form.kind,
    title: form.title.trim(),
    description: form.description.trim() || null,
    status: form.status,
    area: form.area,
    priority: Number(form.priority),
    dueDate: form.dueDate || null,
    assignee: form.assignee.trim() || null,
    metric: isGoal.value ? form.metric || null : null,
    target: isGoal.value && form.metric ? target : null,
    goalId: isGoal.value ? null : form.goalId || null,
    attachments: form.attachments,
  }
}

async function save() {
  if (!form.title.trim()) {
    titleError.value = 'Напишите, что нужно сделать'
    return
  }
  const body = payload()
  const done = await run(
    () => props.item
      ? adminFetch(`/plans/${props.item.id}`, { method: 'PATCH', body })
      : adminFetch('/plans', { method: 'POST', body }),
    { error: 'Не удалось сохранить', success: props.item ? 'Сохранено' : 'Добавлено', key: 'save' },
  )
  if (done !== undefined) {
    open.value = false
    emit('saved')
  }
}

async function remove() {
  if (!props.item) return
  const done = await run(() => adminFetch(`/plans/${props.item!.id}`, { method: 'DELETE' }), {
    error: 'Не удалось удалить',
    success: 'Удалено',
    key: 'delete',
  })
  if (done !== undefined) {
    confirmDelete.value = false
    open.value = false
    emit('deleted')
  }
}

/** On an existing item the list is saved straight away. */
async function persistAttachments() {
  if (!props.item) return
  try {
    await adminFetch(`/plans/${props.item.id}`, { method: 'PATCH', body: { attachments: form.attachments } })
    emit('saved')
  }
  catch (error) {
    toast.error(errorMessage(error, 'Скриншот загружен, но не сохранён в пункте — нажмите «Сохранить»'))
  }
}

function stamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Скриншот ${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function uploadFiles(files: File[]) {
  const images = files.filter(f => f.type.startsWith('image/'))
  if (!images.length) return
  let added = 0
  for (const file of images) {
    if (file.size > 15 * 1024 * 1024) {
      toast.error(`«${file.name}» больше 15 МБ`)
      continue
    }
    const body = new FormData()
    body.append('file', file)
    uploading.value++
    try {
      const { url } = await adminFetch<{ url: string }>('/media/upload?kind=screenshot', { method: 'POST', body })
      const pasted = !file.name || /^image\.\w+$/.test(file.name)
      form.attachments.push({ url, name: pasted ? stamp() : file.name })
      added++
    }
    catch (error) {
      toast.error(errorMessage(error, 'Не удалось загрузить скриншот'))
    }
    finally {
      uploading.value--
    }
  }
  if (added) await persistAttachments()
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  uploadFiles(files)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  uploadFiles([...(event.dataTransfer?.files ?? [])])
}

function onPaste(event: ClipboardEvent) {
  if (!open.value) return
  const files = [...(event.clipboardData?.items ?? [])]
    .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
    .map(i => i.getAsFile())
    .filter((f): f is File => f !== null)
  if (!files.length) return
  event.preventDefault()
  uploadFiles(files)
}

async function removeAttachment(index: number) {
  form.attachments.splice(index, 1)
  await persistAttachments()
}

onMounted(() => document.addEventListener('paste', onPaste))
onBeforeUnmount(() => document.removeEventListener('paste', onPaste))
</script>

<template>
  <UiModal v-model:open="open" :title="heading" size="lg">
    <form class="admin-form" @submit.prevent="save">
      <div class="admin-form-row">
        <UiField label="Что это" for="plan-kind">
          <UiSelect id="plan-kind" v-model="form.kind" :options="kindOptions" />
        </UiField>
        <UiField label="Направление" for="plan-area">
          <UiSelect id="plan-area" v-model="form.area" :options="planAreaOptions" />
        </UiField>
      </div>

      <UiField :label="isGoal ? 'Цель' : 'Что сделать'" :error="titleError" required for="plan-title">
        <UiInput
          id="plan-title"
          v-model="form.title"
          :invalid="Boolean(titleError)"
          :placeholder="isGoal ? 'Например: 10 заказов в месяц' : 'Например: дать сеошнику доступ к Метрике'"
        />
      </UiField>

      <UiField label="Подробности" for="plan-description" hint="Цифры, ссылки, договорённости — всё, что понадобится, чтобы не вспоминать.">
        <UiTextarea id="plan-description" v-model="form.description" :rows="4" />
      </UiField>

      <div class="admin-form-row">
        <UiField label="Статус" for="plan-status">
          <UiSelect id="plan-status" v-model="form.status" :options="planStatusOptions" />
        </UiField>
        <UiField label="Важность" for="plan-priority">
          <UiSelect id="plan-priority" v-model="form.priority" :options="planPriorityOptions" />
        </UiField>
      </div>

      <div class="admin-form-row">
        <UiField label="Срок" for="plan-due">
          <UiInput id="plan-due" v-model="form.dueDate" type="date" />
        </UiField>
        <UiField label="Кто делает" for="plan-assignee">
          <UiInput id="plan-assignee" v-model="form.assignee" placeholder="владелец, сеошник, разработка…" />
        </UiField>
      </div>

      <div v-if="isGoal" class="admin-form-row">
        <UiField label="Чем измеряем" for="plan-metric" hint="Считается само по данным сайта, вписывать ничего не нужно.">
          <UiSelect id="plan-metric" v-model="form.metric" :options="metricOptions" />
        </UiField>
        <UiField v-if="form.metric" label="Цель (число)" for="plan-target">
          <UiInput id="plan-target" v-model="form.target" type="number" min="0" step="any" />
        </UiField>
      </div>
      <UiField v-else label="К какой цели относится" for="plan-goal">
        <UiSelect id="plan-goal" v-model="form.goalId" :options="goalOptions" />
      </UiField>

      <div
        class="attachments"
        :class="{ 'is-dragging': dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <div class="attachments-head">
          <span class="attachments-title">Скриншоты</span>
          <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden @change="onPick">
          <UiButton variant="secondary" size="sm" :loading="uploading > 0" @click="fileInput?.click()">
            <UiIcon name="upload" :size="16" />
            Прикрепить
          </UiButton>
        </div>
        <p class="admin-muted hint">Можно перетащить файлы сюда или вставить из буфера — Ctrl+V (на Mac ⌘V).</p>
        <ul v-if="form.attachments.length" class="thumbs">
          <li v-for="(file, index) in form.attachments" :key="file.url" class="thumb">
            <a :href="file.url" target="_blank" rel="noopener" :title="file.name || 'Открыть'">
              <img :src="file.url" :alt="file.name || 'Скриншот'" loading="lazy">
            </a>
            <span class="thumb-name">{{ file.name || 'Скриншот' }}</span>
            <button type="button" class="thumb-remove" :aria-label="`Убрать ${file.name || 'скриншот'}`" @click="removeAttachment(index)">
              <UiIcon name="close" :size="14" />
            </button>
          </li>
        </ul>
      </div>

      <p v-if="item" class="admin-muted hint">
        Добавлено {{ formatDateTimeWithYear(item.createdAt) }}<template v-if="item.createdByName"> · {{ item.createdByName }}</template>
        <template v-if="item.doneAt"> · сделано {{ formatDateTimeWithYear(item.doneAt) }}</template>
      </p>
    </form>

    <template #footer>
      <UiButton v-if="item" variant="ghost" class="delete" @click="confirmDelete = true">Удалить</UiButton>
      <UiButton variant="ghost" @click="open = false">Отмена</UiButton>
      <UiButton :loading="busy === 'save'" :disabled="uploading > 0" @click="save">
        {{ item ? 'Сохранить' : 'Создать' }}
      </UiButton>
    </template>
  </UiModal>

  <UiConfirm v-model:open="confirmDelete" title="Удалить пункт?" :busy="busy === 'delete'" @confirm="remove">
    «{{ item?.title }}» пропадёт из планов вместе со списком скриншотов.
    <template v-if="item?.kind === 'GOAL' && item.tasksTotal"> Задачи цели останутся, просто без цели.</template>
  </UiConfirm>
</template>

<style scoped>
.hint {
  font-size: var(--text-xs);
}

.attachments {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
  transition: border-color 0.15s, background 0.15s;
}

.attachments.is-dragging {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.attachments-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.attachments-head > :last-child {
  flex: none;
  white-space: nowrap;
}

.attachments-title {
  color: var(--text-strong);
  font-weight: 600;
}

.thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.thumb {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.thumb a {
  display: block;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm, 8px);
  background: var(--surface-sunken);
  aspect-ratio: 4 / 3;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top left;
}

.thumb-name {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thumb-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--surface-card);
  box-shadow: 0 1px 3px rgb(0 0 0 / 20%);
  color: var(--text-strong);
  cursor: pointer;
  place-items: center;
}

.delete {
  margin-right: auto;
  color: var(--danger);
}
</style>
