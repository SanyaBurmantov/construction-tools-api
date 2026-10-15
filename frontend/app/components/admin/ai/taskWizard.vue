<script setup lang="ts">
/**
 * "Создать задачу ИИ" for the rows picked on the products/categories screen:
 * 1) name + when to run, 2) which fields, 3) which prompt, 4) model, with a
 * one-item dry run before anything is written.
 */
import type { AiEntity, AiFieldChange, AiModel, AiPrompt, AiSelection, AiStatus, AiTask } from '~/types/ai'

const props = defineProps<{
  entity: AiEntity
  selection: AiSelection | null
  status: AiStatus | null
  /** A row to dry-run the prompt on. */
  previewId?: string | null
  previewName?: string | null
}>()

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [task: AiTask] }>()

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()

const entityWord = computed(() => (props.entity === 'PRODUCT' ? 'товаров' : 'категорий'))
const fieldDefs = computed(() => props.status?.fields[props.entity] ?? [])

const prompts = ref<AiPrompt[]>([])
const models = ref<AiModel[]>([])

const blankForm = () => ({
  name: '',
  runAt: 'now' as 'now' | 'later',
  scheduledAt: '',
  fields: [] as string[],
  promptId: '' as string,
  prompt: '',
  savePrompt: false,
  promptName: '',
  model: '',
  batchSize: 5 as number | null,
})
const form = reactive(blankForm())
const formError = ref('')
const saving = ref(false)

const preview = ref<{ model: string, changes: Record<string, AiFieldChange>, raw: string } | null>(null)
const previewError = ref('')
const previewing = ref(false)

watch(open, async (isOpen) => {
  if (!isOpen) return
  Object.assign(form, blankForm())
  form.name = `${props.entity === 'PRODUCT' ? 'Товары' : 'Категории'} · ${new Date().toLocaleDateString('ru-BY')}`
  form.model = props.status?.defaultModel ?? ''
  formError.value = ''
  preview.value = null
  previewError.value = ''
  const [loadedPrompts, loadedModels] = await Promise.all([
    adminFetch<AiPrompt[]>('/ai/prompts', { params: { entity: props.entity } }).catch(() => []),
    models.value.length ? Promise.resolve(models.value) : adminFetch<AiModel[]>('/ai/models').catch(() => []),
  ])
  prompts.value = loadedPrompts
  models.value = loadedModels
})

watch(() => form.promptId, (id) => {
  const prompt = prompts.value.find((p) => p.id === id)
  if (prompt) form.prompt = prompt.text
})

const promptOptions = computed(() => [
  { value: '', label: 'Свой текст' },
  ...prompts.value.map((p) => ({ value: p.id, label: p.name })),
])

const modelOptions = computed(() => {
  const options = models.value.map((m) => ({ value: m.id, label: m.name }))
  if (form.model && !options.some((o) => o.value === form.model)) {
    options.unshift({ value: form.model, label: form.model })
  }
  return options
})

function toggleField(key: string, on: boolean) {
  form.fields = on ? [...new Set([...form.fields, key])] : form.fields.filter((k) => k !== key)
}

const requests = computed(() => {
  const count = props.selection?.count ?? 0
  const batch = Math.max(1, Number(form.batchSize) || 1)
  return Math.ceil(count / batch)
})

function validate() {
  if (!form.name.trim()) return 'Укажите название задачи'
  if (!form.fields.length) return 'Выберите хотя бы одно поле'
  if (!form.prompt.trim()) return 'Напишите промпт'
  if (form.runAt === 'later' && !form.scheduledAt) return 'Укажите время запуска'
  if (form.savePrompt && !form.promptName.trim()) return 'Укажите название промпта'
  return ''
}

async function runPreview() {
  previewError.value = ''
  preview.value = null
  if (!props.previewId) return
  if (!form.fields.length || !form.prompt.trim()) {
    previewError.value = 'Сначала выберите поля и напишите промпт'
    return
  }
  previewing.value = true
  try {
    preview.value = await adminFetch('/ai/preview', {
      method: 'POST',
      body: {
        entity: props.entity,
        id: props.previewId,
        fields: form.fields,
        prompt: form.prompt,
        model: form.model || undefined,
      },
    })
  } catch (error) {
    previewError.value = errorMessage(error, 'Модель не ответила')
  } finally {
    previewing.value = false
  }
}

async function submit() {
  formError.value = validate()
  if (formError.value || !props.selection) return
  saving.value = true
  try {
    let promptId = form.promptId || undefined
    if (form.savePrompt) {
      const saved = await adminFetch<AiPrompt>('/ai/prompts', {
        method: 'POST',
        body: { name: form.promptName.trim(), entity: props.entity, text: form.prompt },
      })
      promptId = saved.id
    }
    const task = await adminFetch<AiTask>('/ai/tasks', {
      method: 'POST',
      body: {
        name: form.name.trim(),
        entity: props.entity,
        fields: form.fields,
        promptId,
        prompt: form.prompt,
        model: form.model || undefined,
        batchSize: Number(form.batchSize) || 5,
        scheduledAt: form.runAt === 'later' ? new Date(form.scheduledAt).toISOString() : undefined,
        ...(props.selection.mode === 'ids'
          ? { ids: props.selection.ids }
          : { filter: props.selection.filter }),
      },
    })
    toast.success(`Задача создана: ${task.total} ${entityWord.value}`)
    open.value = false
    emit('created', task)
  } catch (error) {
    formError.value = errorMessage(error, 'Не удалось создать задачу')
  } finally {
    saving.value = false
  }
}

const fieldLabel = (key: string) => fieldDefs.value.find((f) => f.key === key)?.label ?? key
</script>

<template>
  <UiModal v-model:open="open" title="Новая задача ИИ" size="lg">
    <UiAlert v-if="status && !status.enabled" tone="warning" class="block">
      OPENROUTER_API_KEY не задан на сервере — задача встанет в очередь, но выполняться не будет.
    </UiAlert>
    <UiAlert v-if="formError" tone="danger" class="block">{{ formError }}</UiAlert>

    <p class="scope">
      Будет обработано: <strong>{{ selection?.count ?? 0 }}</strong> {{ entityWord }}
      <span v-if="selection?.mode === 'filter'">(все по текущему фильтру)</span>
      · запросов к модели: <strong>{{ requests }}</strong>
      <template v-if="status?.quota?.dailyRemaining != null">
        · осталось сегодня: <strong>{{ status.quota.dailyRemaining }}</strong> из {{ status.quota.dailyLimit }}
      </template>
    </p>

    <section class="step">
      <h3><span>1</span> Задача</h3>
      <div class="row">
        <UiField label="Название" required for="ai-name">
          <UiInput id="ai-name" v-model="form.name" />
        </UiField>
        <UiField label="Запуск" for="ai-run">
          <UiSelect
            id="ai-run"
            v-model="form.runAt"
            :options="[
              { value: 'now', label: 'Сразу (в течение минуты)' },
              { value: 'later', label: 'По расписанию' }
            ]"
          />
        </UiField>
      </div>
      <UiField v-if="form.runAt === 'later'" label="Время запуска" for="ai-at">
        <UiInput id="ai-at" v-model="form.scheduledAt" type="datetime-local" />
      </UiField>
    </section>

    <section class="step">
      <h3><span>2</span> Поля для обновления</h3>
      <div class="fields">
        <UiCheckbox
          v-for="field in fieldDefs"
          :key="field.key"
          :model-value="form.fields.includes(field.key)"
          @update:model-value="toggleField(field.key, Boolean($event))"
        >
          {{ field.label }} <small>— {{ field.hint }}</small>
        </UiCheckbox>
      </div>
      <p v-if="entity === 'PRODUCT'" class="note">
        Изменённые поля закрепляются: ежедневный перепарсинг их больше не перезапишет (откат задачи снимает закрепление).
      </p>
    </section>

    <section class="step">
      <h3><span>3</span> Промпт</h3>
      <UiField label="Шаблон" for="ai-prompt-pick">
        <UiSelect id="ai-prompt-pick" v-model="form.promptId" :options="promptOptions" />
      </UiField>
      <UiField
        label="Что сделать"
        required
        hint="Данные записи (название, бренд, категория, характеристики, текущие тексты) и формат ответа добавляются автоматически"
        for="ai-prompt"
      >
        <UiTextarea
          id="ai-prompt"
          v-model="form.prompt"
          :rows="6"
          placeholder="Перепиши описание продающим, но без воды: 2–3 абзаца, назначение, ключевые характеристики, для кого подходит."
        />
      </UiField>
      <div v-if="!form.promptId" class="row">
        <UiCheckbox v-model="form.savePrompt" label="Сохранить как шаблон" />
        <UiInput v-if="form.savePrompt" v-model="form.promptName" size="sm" placeholder="Название шаблона" />
      </div>
    </section>

    <section class="step">
      <h3><span>4</span> Модель и проверка</h3>
      <div class="row">
        <UiField label="Модель (бесплатные OpenRouter)" for="ai-model">
          <UiSelect id="ai-model" v-model="form.model" :options="modelOptions" />
        </UiField>
        <UiField label="Записей в одном запросе" hint="Бесплатный ключ считает запросы, не токены" for="ai-batch">
          <UiInput id="ai-batch" v-model="form.batchSize" type="number" min="1" max="20" />
        </UiField>
      </div>

      <div v-if="previewId" class="preview">
        <UiButton size="sm" variant="secondary" :loading="previewing" @click="runPreview">
          Проверить на «{{ previewName }}»
        </UiButton>
        <span class="note">Один запрос, ничего не сохраняется</span>
        <UiAlert v-if="previewError" tone="danger">{{ previewError }}</UiAlert>
        <div v-if="preview" class="diff">
          <p class="note">Ответила модель: {{ preview.model }}</p>
          <p v-if="!Object.keys(preview.changes).length" class="note">Модель ничего не изменила бы.</p>
          <div v-for="(change, key) in preview.changes" :key="key" class="diff-row">
            <strong>{{ fieldLabel(String(key)) }}</strong>
            <del>{{ change.old || '—' }}</del>
            <ins>{{ change.new }}</ins>
          </div>
        </div>
      </div>
    </section>

    <template #footer>
      <UiButton variant="ghost" @click="open = false">Отмена</UiButton>
      <UiButton :loading="saving" :disabled="!selection?.count" @click="submit">Создать задачу</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.block {
  margin-bottom: var(--space-4);
}

.scope {
  margin-bottom: var(--space-4);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.scope strong {
  color: var(--text-strong);
}

.step {
  display: flex;
  flex-direction: column;
  padding: var(--space-4) 0;
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-3);
}

.step h3 {
  display: flex;
  align-items: center;
  font-size: var(--text-base);
  gap: var(--space-2);
}

.step h3 span {
  display: grid;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--brand-soft);
  color: var(--brand-soft-text);
  font-size: var(--text-xs);
  place-items: center;
}

.row {
  display: grid;
  align-items: end;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.fields small {
  color: var(--text-muted);
}

.note {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.preview {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.diff {
  display: flex;
  width: 100%;
  flex-direction: column;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  gap: var(--space-3);
}

.diff-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-sm);
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

@media (max-width: 640px) {
  .row {
    grid-template-columns: 1fr;
  }
}
</style>
