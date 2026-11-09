<script setup lang="ts">
/**
 * «Создать задачу ИИ» for the rows picked on a tab of «ИИ-тексты»:
 * 1) a template (built-in or saved) fills the form, 2) the fields and an
 * instruction per field, 3) the general instruction and the shop rules,
 * 4) «как соберётся запрос» (free) and a one-record dry run, 5) the launch.
 *
 * What the model gets is assembled from blocks, and the wizard shows them:
 * the answer format is fixed in code, the shop rules come from «Шаблоны и
 * правила», the instructions are this task's. Phrases in quotes go into the
 * text verbatim — the backend's checks let them through (`ai-phrases.ts`).
 */
import type {
  AiEntity,
  AiExplain,
  AiModel,
  AiPreset,
  AiPreview,
  AiPrompt,
  AiPromptBlock,
  AiSelection,
  AiStatus,
  AiTask,
  AiTemplates,
} from '~/types/ai'
import { AI_ENTITY_GENITIVE, hasPlaceholders, quotedPhrases } from '~/types/ai'

const props = defineProps<{
  entity: AiEntity
  selection: AiSelection | null
  status: AiStatus | null
  /** A row to dry-run the prompt on. */
  previewId?: string | null
  previewName?: string | null
}>()

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [task: AiTask & { tasks?: Array<{ id: string, name: string, total: number }> }] }>()

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()

const entityWord = computed(() => AI_ENTITY_GENITIVE[props.entity])
const fieldDefs = computed(() => props.status?.fields[props.entity] ?? [])

const prompts = ref<AiPrompt[]>([])
const models = ref<AiModel[]>([])
const library = ref<AiTemplates | null>(null)

const blankForm = () => ({
  name: '',
  runAt: 'now' as 'now' | 'later',
  scheduledAt: '',
  /** '' | `preset:<id>` | `prompt:<id>` */
  template: '',
  fields: [] as string[],
  fieldTexts: {} as Record<string, string>,
  general: '',
  /** Built-in shop rules + a guide per kind of product; the instructions are added. */
  rules: true,
  savePrompt: false,
  promptName: '',
  model: '',
  batchSize: 5 as number | null,
})
const form = reactive(blankForm())
const formError = ref('')
const saving = ref(false)

const explained = ref<AiExplain | null>(null)
const explaining = ref(false)
const preview = ref<AiPreview | null>(null)
const previewError = ref('')
const previewing = ref(false)

const ENTITY_NAME: Record<AiEntity, string> = { PRODUCT: 'Товары', CATEGORY: 'Категории', BRAND: 'Бренды' }

watch(open, async (isOpen) => {
  if (!isOpen) return
  Object.assign(form, blankForm())
  form.name = `${ENTITY_NAME[props.entity]} · ${formatDate(new Date().toISOString())}`
  form.model = props.status?.defaultModel ?? ''
  formError.value = ''
  explained.value = null
  preview.value = null
  previewError.value = ''
  const [loadedPrompts, loadedModels, loadedLibrary] = await Promise.all([
    adminFetch<AiPrompt[]>('/ai/prompts', { params: { entity: props.entity } }).catch(() => []),
    models.value.length ? Promise.resolve(models.value) : adminFetch<AiModel[]>('/ai/models').catch(() => []),
    library.value ? Promise.resolve(library.value) : adminFetch<AiTemplates>('/ai/templates').catch(() => null),
  ])
  prompts.value = loadedPrompts
  models.value = loadedModels
  library.value = loadedLibrary
})

const presets = computed<AiPreset[]>(() =>
  (library.value?.presets ?? []).filter(preset => preset.entity === props.entity))

const templateOptions = computed(() => [
  { value: '', label: 'Без шаблона — напишу сам' },
  ...presets.value.map(preset => ({ value: `preset:${preset.id}`, label: `Готовый · ${preset.title}` })),
  ...prompts.value.map(prompt => ({ value: `prompt:${prompt.id}`, label: `Мой · ${prompt.name}` })),
])

const pickedPreset = computed(() =>
  presets.value.find(preset => `preset:${preset.id}` === form.template) ?? null)
const pickedPrompt = computed(() =>
  prompts.value.find(prompt => `prompt:${prompt.id}` === form.template) ?? null)

/** A template fills the form; the admin edits from there. */
watch(() => form.template, () => {
  const preset = pickedPreset.value
  const prompt = pickedPrompt.value
  if (!preset && !prompt) return
  const fields = preset?.fields ?? (prompt?.fields?.length ? prompt.fields : Object.keys(prompt?.fieldTexts ?? {}))
  form.fields = fields.filter(key => fieldDefs.value.some(field => field.key === key))
  form.general = preset?.general ?? prompt?.text ?? ''
  form.fieldTexts = { ...(preset?.fieldTexts ?? prompt?.fieldTexts ?? {}) }
  explained.value = null
  preview.value = null
})

const guideOf = (key: string) =>
  library.value?.fieldGuide.find(field => field.entity === props.entity && field.key === key)

const modelOptions = computed(() => {
  const options = models.value.map(m => ({ value: m.id, label: m.name }))
  if (form.model && !options.some(o => o.value === form.model)) {
    options.unshift({ value: form.model, label: form.model })
  }
  return options
})

function toggleField(key: string, on: boolean) {
  form.fields = on ? [...new Set([...form.fields, key])] : form.fields.filter(k => k !== key)
}

/** Only the ticked fields' instructions go to the backend. */
const fieldPrompts = computed(() => Object.fromEntries(
  form.fields
    .map(key => [key, (form.fieldTexts[key] ?? '').trim()] as const)
    .filter(([, text]) => text),
))
const ownTexts = computed(() => [form.general, ...Object.values(fieldPrompts.value)])
const phrases = computed(() => quotedPhrases(ownTexts.value))
const placeholdersLeft = computed(() => hasPlaceholders(ownTexts.value))
const hasOwnInstruction = computed(() => Boolean(form.general.trim() || Object.keys(fieldPrompts.value).length))

const requests = computed(() => {
  const count = props.selection?.count ?? 0
  const batch = Math.max(1, Number(form.batchSize) || 1)
  return Math.ceil(count / batch)
})

function instructionError() {
  if (!form.fields.length) return 'Выберите хотя бы одно поле'
  if (!form.rules && !hasOwnInstruction.value) return 'Без правил магазина нужна своя инструкция — общая или к полю'
  return ''
}

function validate() {
  if (!form.name.trim()) return 'Укажите название задачи'
  const error = instructionError()
  if (error) return error
  if (placeholdersLeft.value) return 'В инструкции остались [квадратные скобки] из шаблона — замените их своим текстом'
  if (form.runAt === 'later' && !form.scheduledAt) return 'Укажите время запуска'
  if (form.savePrompt && !form.promptName.trim()) return 'Укажите название шаблона'
  return ''
}

const requestBody = () => ({
  entity: props.entity,
  fields: form.fields,
  prompt: form.general,
  fieldPrompts: fieldPrompts.value,
  templates: form.rules,
})

async function explain() {
  previewError.value = ''
  if (!props.previewId) return
  const error = instructionError()
  if (error) {
    previewError.value = error
    return
  }
  explaining.value = true
  try {
    explained.value = await adminFetch<AiExplain>('/ai/templates/explain', {
      method: 'POST',
      body: { ...requestBody(), id: props.previewId },
    })
  } catch (failure) {
    previewError.value = errorMessage(failure, 'Не удалось собрать запрос')
  } finally {
    explaining.value = false
  }
}

async function runPreview() {
  previewError.value = ''
  preview.value = null
  if (!props.previewId) return
  const error = instructionError()
  if (error) {
    previewError.value = error
    return
  }
  previewing.value = true
  try {
    preview.value = await adminFetch<AiPreview>('/ai/preview', {
      method: 'POST',
      body: { ...requestBody(), id: props.previewId, model: form.model || undefined },
    })
  } catch (failure) {
    previewError.value = errorMessage(failure, 'Модель не ответила')
  } finally {
    previewing.value = false
  }
}

async function submit() {
  formError.value = validate()
  if (formError.value || !props.selection) return
  saving.value = true
  try {
    let promptId = pickedPrompt.value?.id
    if (form.savePrompt) {
      const saved = await adminFetch<AiPrompt>('/ai/prompts', {
        method: 'POST',
        body: {
          name: form.promptName.trim(),
          entity: props.entity,
          text: form.general,
          fields: form.fields,
          fieldTexts: fieldPrompts.value,
        },
      })
      promptId = saved.id
      // Saved once: if the task request below fails, the retry must reuse
      // this template instead of saving a second copy of it.
      prompts.value = [...prompts.value, saved]
      form.template = `prompt:${saved.id}`
      form.savePrompt = false
    }
    const task = await adminFetch<AiTask & { tasks?: Array<{ id: string, name: string, total: number }> }>('/ai/tasks', {
      method: 'POST',
      body: {
        ...requestBody(),
        name: form.name.trim(),
        promptId,
        model: form.model || undefined,
        batchSize: Number(form.batchSize) || 5,
        scheduledAt: form.runAt === 'later' ? fromLocalInput(form.scheduledAt) ?? undefined : undefined,
        ...(props.selection.mode === 'ids'
          ? { ids: props.selection.ids }
          : { filter: props.selection.filter }),
      },
    })
    const created = task.tasks ?? [task]
    toast.success(
      created.length > 1
        ? `Создано задач по видам товаров: ${created.length}, всего ${created.reduce((sum, t) => sum + t.total, 0)} ${entityWord.value}`
        : `Задача создана: ${task.total} ${entityWord.value}`,
    )
    open.value = false
    emit('created', task)
  } catch (error) {
    formError.value = errorMessage(error, 'Не удалось создать задачу')
  } finally {
    saving.value = false
  }
}

const fieldLabel = (key: string) => fieldDefs.value.find(f => f.key === key)?.label ?? key

const BLOCK_BADGE: Record<AiPromptBlock['kind'], { label: string, tone: 'neutral' | 'brand' | 'info' | 'success' }> = {
  fixed: { label: 'фиксировано в коде', tone: 'neutral' },
  rules: { label: 'из «Шаблоны и правила»', tone: 'info' },
  guide: { label: 'из «Шаблоны и правила»', tone: 'info' },
  task: { label: 'ваши требования', tone: 'brand' },
  data: { label: 'подставляется автоматически', tone: 'success' },
}

const RULES_LABEL: Record<AiEntity, string> = {
  PRODUCT: 'Правила магазина и гайд по виду товара (рекомендуется)',
  CATEGORY: 'Правила магазина для категорий (рекомендуется)',
  BRAND: 'Правила магазина для брендов (рекомендуется)',
}
</script>

<template>
  <UiModal v-model:open="open" title="Новая задача ИИ" size="lg">
    <UiAlert v-if="status && !status.enabled" tone="warning" class="block">
      Ключ ИИ (DEEPSEEK_API_KEY) не задан на сервере — задача встанет в очередь, но выполняться не будет.
    </UiAlert>
    <UiAlert v-if="formError" tone="danger" class="block">{{ formError }}</UiAlert>

    <p class="scope">
      Будет обработано: <strong>{{ selection?.count ?? 0 }}</strong> {{ entityWord }}
      <span v-if="selection?.mode === 'filter'">(все по текущему фильтру)</span>
      · запросов к модели: <strong>{{ requests }}</strong>
      <template v-if="status?.quota?.dailyRemaining != null">
        · осталось сегодня: <strong>{{ status.quota.dailyRemaining }}</strong> из {{ status.quota.dailyLimit }}
      </template>
      <template v-if="status?.quota?.balance">
        · баланс: <strong>{{ status.quota.balance }}</strong>
      </template>
    </p>

    <section class="step">
      <h3><span>1</span> Шаблон</h3>
      <UiSelect v-model="form.template" :options="templateOptions" aria-label="Шаблон" />
      <p v-if="pickedPreset" class="note">{{ pickedPreset.goal }} Поправьте то, что в [квадратных скобках].</p>
      <p v-else class="note">
        Шаблон заполнит поля и инструкции ниже — дальше их можно править. Свои шаблоны — во вкладке «Шаблоны и правила».
      </p>
    </section>

    <section class="step">
      <h3><span>2</span> Поля и что с ними сделать</h3>
      <div class="fields">
        <div v-for="field in fieldDefs" :key="field.key" class="field" :class="{ 'is-on': form.fields.includes(field.key) }">
          <UiCheckbox
            :model-value="form.fields.includes(field.key)"
            @update:model-value="toggleField(field.key, Boolean($event))"
          >
            <strong>{{ field.label }}</strong> <small>— {{ guideOf(field.key)?.length ?? field.hint }}</small>
          </UiCheckbox>
          <template v-if="form.fields.includes(field.key)">
            <small v-if="guideOf(field.key)" class="where">Где видно: {{ guideOf(field.key)?.where }}</small>
            <UiTextarea
              v-model="form.fieldTexts[field.key]"
              :rows="2"
              :aria-label="`Инструкция для поля ${field.label}`"
              placeholder="Необязательно. Например: в конце «купить в Минске по низким ценам»"
            />
          </template>
        </div>
      </div>
      <p v-if="entity === 'PRODUCT'" class="note">
        Изменённые поля закрепляются: ежедневный перепарсинг их не перезапишет (откат задачи снимает закрепление).
      </p>
    </section>

    <section class="step">
      <h3><span>3</span> Общие требования</h3>
      <UiCheckbox v-model="form.rules" :label="RULES_LABEL[entity]" />
      <p v-if="form.rules" class="note">
        Только факты из данных, полные названия, «оплата по безналу» в SEO-описании — правила правятся во вкладке «Шаблоны и правила».
        <template v-if="entity === 'PRODUCT'">Товары разных видов (крепёж, оснастка, электроинструмент…) получат свой гайд — задача разделится по видам.</template>
      </p>
      <UiField
        :label="form.rules ? 'Требования ко всем полям (необязательно)' : 'Что сделать'"
        hint="Данные записи и формат ответа подставляются автоматически. Ваши требования важнее правил магазина."
        for="ai-general"
      >
        <UiTextarea
          id="ai-general"
          v-model="form.general"
          :rows="4"
          placeholder="Пиши для закупщика организации: коротко, по делу. Везде, где уместно, добавляй «оптом и в розницу»."
        />
      </UiField>
      <UiAlert tone="info" class="quotes">
        Фразы в «кавычках» (от двух слов) попадут в текст дословно — проверки и очистка их не вырежут.
        <template v-if="phrases.length">
          Сейчас: <span v-for="phrase in phrases" :key="phrase" class="phrase">«{{ phrase }}»</span>
        </template>
      </UiAlert>
      <UiAlert v-if="placeholdersLeft" tone="warning">
        В инструкции остались [квадратные скобки] из шаблона — замените их своим текстом, иначе модель получит их как есть.
      </UiAlert>
    </section>

    <section class="step">
      <h3><span>4</span> Проверка</h3>
      <div v-if="previewId" class="preview">
        <div class="actions">
          <UiButton size="sm" variant="secondary" :loading="explaining" @click="explain">
            Как соберётся запрос (бесплатно)
          </UiButton>
          <UiButton size="sm" variant="secondary" :loading="previewing" @click="runPreview">
            Проверить на «{{ previewName }}»
          </UiButton>
        </div>
        <span class="note">Проверка — один запрос к модели, ничего не записывается.</span>
        <UiAlert v-if="previewError" tone="danger">{{ previewError }}</UiAlert>

        <div v-if="explained" class="blocks">
          <p v-if="explained.template" class="note">Вид товара: <strong>{{ explained.template.label }}</strong></p>
          <details v-for="(block, index) in explained.blocks" :key="index" class="prompt-block" :open="block.kind === 'task'">
            <summary>
              <strong>{{ block.title }}</strong>
              <UiBadge size="sm" :tone="BLOCK_BADGE[block.kind].tone">{{ BLOCK_BADGE[block.kind].label }}</UiBadge>
            </summary>
            <pre>{{ block.text }}</pre>
          </details>
        </div>

        <div v-if="preview" class="diff">
          <p class="note">
            Ответила модель: {{ preview.model }}
            <template v-if="preview.template"> · вид: {{ preview.template }}</template>
            <template v-if="preview.usage"> · токенов: {{ preview.usage.promptTokens }} + {{ preview.usage.completionTokens }}</template>
            <template v-if="preview.repairs"> · модель исправила поля после проверки</template>
          </p>
          <p v-if="!Object.keys(preview.changes).length && !Object.keys(preview.rejected).length" class="note">Модель ничего не изменила бы.</p>
          <div v-for="(change, key) in preview.changes" :key="key" class="diff-row">
            <strong>{{ fieldLabel(String(key)) }}</strong>
            <del>{{ change.old || '—' }}</del>
            <ins>{{ change.new }}</ins>
            <span v-if="aiQualityLine(preview.quality?.[String(key)])" class="note">{{ aiQualityLine(preview.quality?.[String(key)]) }}</span>
          </div>
          <div v-for="(item, key) in preview.rejected" :key="`r-${key}`" class="diff-row">
            <strong>{{ fieldLabel(String(key)) }} — не будет записано</strong>
            <span class="error">{{ item.reason }}</span>
            <del>{{ item.value }}</del>
          </div>
        </div>
      </div>
      <p v-else class="note">Отметьте записи — проверка идёт на первой из них.</p>
    </section>

    <section class="step">
      <h3><span>5</span> Запуск</h3>
      <div class="row">
        <UiField label="Название задачи" required for="ai-name">
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
      <div class="row">
        <UiField :label="status?.provider === 'OpenRouter' ? 'Модель (бесплатные OpenRouter)' : 'Модель'" for="ai-model">
          <UiSelect id="ai-model" v-model="form.model" :options="modelOptions" />
        </UiField>
        <UiField
          label="Записей в одном запросе"
          :hint="status?.provider === 'OpenRouter' ? 'Бесплатный ключ считает запросы, не токены' : 'Больше — дешевле за счёт общего начала запроса, меньше — надёжнее'"
          for="ai-batch"
        >
          <UiInput id="ai-batch" v-model="form.batchSize" type="number" min="1" max="20" />
        </UiField>
      </div>
      <div v-if="!pickedPrompt" class="row">
        <UiCheckbox v-model="form.savePrompt" label="Сохранить поля и инструкции как мой шаблон" />
        <UiInput v-if="form.savePrompt" v-model="form.promptName" size="sm" placeholder="Название шаблона" aria-label="Название шаблона" />
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

.fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field {
  display: flex;
  flex-direction: column;
  padding: var(--space-2) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  gap: var(--space-2);
}

.field.is-on {
  border-color: var(--border-subtle);
  background: var(--surface-sunken);
}

.field small,
.where {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.note {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.quotes {
  font-size: var(--text-sm);
}

.phrase {
  margin-left: var(--space-1);
  font-weight: 600;
}

.preview,
.blocks {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.prompt-block {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
}

.prompt-block summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  cursor: pointer;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.prompt-block pre {
  overflow: auto;
  max-height: 320px;
  margin: var(--space-2) 0 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: pre-wrap;
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

.diff-row .error {
  color: var(--danger);
  font-size: var(--text-sm);
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
