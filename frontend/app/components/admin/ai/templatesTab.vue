<script setup lang="ts">
import type {
  AiEntity,
  AiExplain,
  AiPreset,
  AiPreview,
  AiPrompt,
  AiPromptBlock,
  AiTemplateText,
  AiTemplates,
} from '~/types/ai'
import { AI_ENTITY_LABEL, hasPlaceholders, quotedPhrases } from '~/types/ai'

/**
 * «ИИ-тексты → Шаблоны и правила»: everything an AI task sends and checks,
 * on screen and editable — no magic.
 * - «Шаблоны»: the built-in library and the admin's own templates (fields,
 *   a general instruction, one per field), picked in the task wizard;
 * - «Правила магазина»: the shop rules and kind guides every task with rules
 *   gets — an edit applies to the next task (a task keeps the text it was
 *   created with) and to every preview;
 * - «Проверить на товаре»: the assembled request (free) or a live answer;
 * - «Справка»: where each field is seen, and the checks before a write.
 */
const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()
const { status, loadStatus } = useAiStatus()
const { apiBase } = useSite()

const section = ref('library')
const SECTIONS = [
  { value: 'library', label: 'Шаблоны' },
  { value: 'rules', label: 'Правила магазина' },
  { value: 'try', label: 'Проверить на товаре' },
  { value: 'help', label: 'Справка: поля и проверки' },
]

const data = ref<AiTemplates | null>(null)
const prompts = ref<AiPrompt[]>([])
const loadError = ref('')
async function load() {
  try {
    const [templates, saved] = await Promise.all([
      adminFetch<AiTemplates>('/ai/templates'),
      adminFetch<AiPrompt[]>('/ai/prompts'),
    ])
    data.value = templates
    prompts.value = saved
    loadError.value = ''
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить шаблоны')
  }
}
onMounted(() => {
  void load()
  void loadStatus()
})

const { run, busy } = useAdminAction()
const fieldsOf = (entity: AiEntity) => status.value?.fields[entity] ?? []
const fieldLabel = (entity: AiEntity, key: string) =>
  fieldsOf(entity).find(field => field.key === key)?.label ?? key

/* ---- Library ------------------------------------------------------------ */
const libraryEntity = ref<AiEntity>('PRODUCT')
const presets = computed(() => (data.value?.presets ?? []).filter(preset => preset.entity === libraryEntity.value))
const ownPrompts = computed(() => prompts.value.filter(prompt => prompt.entity === libraryEntity.value))

const editor = reactive({
  open: false,
  id: null as string | null,
  name: '',
  entity: 'PRODUCT' as AiEntity,
  fields: [] as string[],
  general: '',
  fieldTexts: {} as Record<string, string>,
  error: '',
  saving: false,
})

function openEditor(source: { prompt?: AiPrompt, preset?: AiPreset } = {}) {
  const { prompt, preset } = source
  Object.assign(editor, {
    open: true,
    id: prompt?.id ?? null,
    name: prompt?.name ?? (preset ? `${preset.title} (моя копия)` : ''),
    entity: prompt?.entity ?? preset?.entity ?? libraryEntity.value,
    fields: [...(prompt?.fields?.length ? prompt.fields : preset?.fields ?? Object.keys(prompt?.fieldTexts ?? {}))],
    general: prompt?.text ?? preset?.general ?? '',
    fieldTexts: { ...(prompt?.fieldTexts ?? preset?.fieldTexts ?? {}) },
    error: '',
    saving: false,
  })
}

function toggleEditorField(key: string, on: boolean) {
  editor.fields = on ? [...new Set([...editor.fields, key])] : editor.fields.filter(k => k !== key)
}

const editorFieldTexts = computed(() => Object.fromEntries(
  editor.fields
    .map(key => [key, (editor.fieldTexts[key] ?? '').trim()] as const)
    .filter(([, text]) => text),
))
const editorPhrases = computed(() => quotedPhrases([editor.general, ...Object.values(editorFieldTexts.value)]))
const editorPlaceholders = computed(() => hasPlaceholders([editor.general, ...Object.values(editorFieldTexts.value)]))

async function saveEditor() {
  if (!editor.name.trim()) {
    editor.error = 'Укажите название'
    return
  }
  if (!editor.fields.length) {
    editor.error = 'Выберите хотя бы одно поле'
    return
  }
  if (!editor.general.trim() && !Object.keys(editorFieldTexts.value).length) {
    editor.error = 'Напишите общую инструкцию или инструкцию хотя бы к одному полю'
    return
  }
  editor.error = ''
  editor.saving = true
  const body = {
    name: editor.name.trim(),
    text: editor.general,
    fields: editor.fields,
    fieldTexts: editorFieldTexts.value,
  }
  try {
    if (editor.id) {
      await adminFetch(`/ai/prompts/${editor.id}`, { method: 'PATCH', body })
    } else {
      await adminFetch('/ai/prompts', { method: 'POST', body: { ...body, entity: editor.entity } })
    }
    editor.open = false
    toast.success('Шаблон сохранён — он есть в мастере задачи')
    prompts.value = await adminFetch<AiPrompt[]>('/ai/prompts').catch(() => prompts.value)
  } catch (error) {
    editor.error = errorMessage(error, 'Не удалось сохранить шаблон')
  } finally {
    editor.saving = false
  }
}

const confirmDelete = ref<AiPrompt | null>(null)
async function deletePrompt() {
  const prompt = confirmDelete.value
  if (!prompt) return
  const done = await run(() => adminFetch(`/ai/prompts/${prompt.id}`, { method: 'DELETE' }), {
    key: `prompt:${prompt.id}`,
    error: 'Не удалось удалить шаблон',
    success: 'Шаблон удалён',
  })
  if (done === undefined) return
  confirmDelete.value = null
  prompts.value = prompts.value.filter(item => item.id !== prompt.id)
}

/* ---- Rules -------------------------------------------------------------- */
const drafts = ref<Record<string, string>>({})
const draft = (text: AiTemplateText) => drafts.value[text.id] ?? text.text
const dirty = (text: AiTemplateText) => drafts.value[text.id] !== undefined && drafts.value[text.id] !== text.text

async function saveText(text: AiTemplateText, value: string | null) {
  const result = await run(
    () => adminFetch<AiTemplates['texts']>(`/ai/templates/${encodeURIComponent(text.id)}`, {
      method: 'PUT',
      body: { text: value },
    }),
    {
      key: text.id,
      error: 'Не удалось сохранить',
      success: value === null ? 'Вернули текст по умолчанию' : 'Сохранено — применится к новым задачам и проверкам',
    },
  )
  if (result && data.value) {
    data.value.texts = result
    drafts.value = Object.fromEntries(
      Object.entries(drafts.value).filter(([id]) => id !== text.id),
    )
  }
}

const rulesTexts = computed(() => data.value
  ? [
      { title: 'Правила для товаров', text: data.value.texts.productRules },
      { title: 'Правила для категорий', text: data.value.texts.categoryRules },
      { title: 'Правила для брендов', text: data.value.texts.brandRules },
    ]
  : [])

const kind = ref('')
const kindText = computed(() => (kind.value && data.value ? data.value.texts.guides[kind.value] : null))
const kindInfo = computed(() => data.value?.kinds.find(item => item.key === kind.value))
watch(data, (value) => {
  if (value && !kind.value) kind.value = value.kinds[0]?.key ?? ''
})

/** How the request is put together — the same order the backend uses. */
const ASSEMBLY = [
  { badge: 'фиксировано в коде', tone: 'neutral', title: 'Формат ответа', text: 'Роль модели, список полей, которые надо вернуть, и формат JSON. Не правится: программа читает ответ по нему.' },
  { badge: 'правится здесь', tone: 'info', title: 'Правила магазина + гайд по виду товара', text: 'Общие для всех задач с галочкой «Правила магазина». Для товара добавляется гайд его вида (крепёж, оснастка, электроинструмент…).' },
  { badge: 'в мастере задачи', tone: 'brand', title: 'Требования задачи', text: 'Общая инструкция и инструкции по полям — из шаблона или свои. Важнее правил магазина: при противоречии модель выполняет их. Фразы в «кавычках» (от двух слов) вставляются дословно.' },
  { badge: 'автоматически', tone: 'success', title: 'Данные записи', text: 'Название, бренд, категория, артикул, характеристики и текущие тексты — для товара; подкатегории и примеры — для категории; категории и товары — для бренда.' },
] as const

/* ---- «Проверить на товаре» --------------------------------------------- */
const productInput = ref('')
const extraPrompt = ref('')
const explained = ref<AiExplain | null>(null)
const preview = ref<AiPreview | null>(null)
const explaining = ref(false)
const previewing = ref(false)

/** A product ID, or its page URL / slug (resolved through the public API). */
async function productId(): Promise<string | null> {
  const value = productInput.value.trim()
  if (!value) return null
  if (/^[0-9a-f-]{36}$/i.test(value)) return value
  const slug = value.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop()
  if (!slug) return null
  try {
    const product = await $fetch<{ id: string }>(`${apiBase}/products/${encodeURIComponent(slug)}`)
    return product.id
  } catch {
    return null
  }
}

async function explain() {
  explaining.value = true
  preview.value = null
  try {
    const id = await productId()
    if (!id) {
      toast.error('Товар не найден — вставьте ссылку на карточку или ID')
      return
    }
    explained.value = await adminFetch<AiExplain>('/ai/templates/explain', {
      method: 'POST',
      body: { entity: 'PRODUCT', id, prompt: extraPrompt.value || undefined },
    })
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось собрать запрос'))
  } finally {
    explaining.value = false
  }
}

/** A live call: one request to the model (+ the second check), nothing written. */
async function runPreview() {
  previewing.value = true
  try {
    const id = await productId()
    if (!id) {
      toast.error('Товар не найден — вставьте ссылку на карточку или ID')
      return
    }
    preview.value = await adminFetch<AiPreview>('/ai/preview', {
      method: 'POST',
      body: {
        entity: 'PRODUCT',
        id,
        templates: true,
        prompt: extraPrompt.value || undefined,
        fields: fieldsOf('PRODUCT').map(field => field.key),
      },
    })
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось получить ответ модели'))
  } finally {
    previewing.value = false
  }
}

const BLOCK_BADGE: Record<AiPromptBlock['kind'], { label: string, tone: 'neutral' | 'brand' | 'info' | 'success' }> = {
  fixed: { label: 'фиксировано в коде', tone: 'neutral' },
  rules: { label: 'правила магазина', tone: 'info' },
  guide: { label: 'гайд по виду', tone: 'info' },
  task: { label: 'требования задачи', tone: 'brand' },
  data: { label: 'автоматически', tone: 'success' },
}

const BY: Record<NonNullable<AiExplain['template']>['by'], string> = {
  name: 'по началу названия',
  category: 'по категории товара',
  chain: 'по цепочке категорий',
  default: 'ни один вид не подошёл — общий гайд',
}

const entityTabs = computed(() => (['PRODUCT', 'CATEGORY', 'BRAND'] as AiEntity[]).map(entity => ({
  value: entity,
  label: AI_ENTITY_LABEL[entity],
  count: (data.value?.presets ?? []).filter(preset => preset.entity === entity).length
    + prompts.value.filter(prompt => prompt.entity === entity).length,
})))
</script>

<template>
  <div class="templates-tab">
    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>
    <UiSkeleton v-else-if="!data" height="320px" radius="var(--radius-md)" />

    <template v-else>
      <UiTabs v-model="section" :tabs="SECTIONS" />

      <!-- Library -->
      <template v-if="section === 'library'">
        <div class="toolbar">
          <UiTabs :model-value="libraryEntity" :tabs="entityTabs" @update:model-value="libraryEntity = $event as AiEntity" />
          <UiButton size="sm" @click="openEditor()">Новый шаблон</UiButton>
        </div>
        <p class="muted">
          Шаблон — это поля и инструкции к ним; в мастере задачи он заполняет форму. Шаблоны дополняют правила магазина и важнее их при противоречии.
          Фразы в «кавычках» (от двух слов) попадают в текст дословно. Заполните то, что в [квадратных скобках].
        </p>

        <h3 v-if="ownPrompts.length" class="group">Мои шаблоны</h3>
        <div v-if="ownPrompts.length" class="cards">
          <article v-for="prompt in ownPrompts" :key="prompt.id" class="card">
            <header>
              <strong>{{ prompt.name }}</strong>
              <UiBadge size="sm" tone="brand">мой</UiBadge>
            </header>
            <p v-if="prompt.fields?.length" class="muted">Поля: {{ prompt.fields.map(key => fieldLabel(prompt.entity, key)).join(', ') }}</p>
            <p v-if="prompt.text" class="text">{{ prompt.text }}</p>
            <dl v-if="prompt.fieldTexts && Object.keys(prompt.fieldTexts).length" class="per-field">
              <div v-for="(text, key) in prompt.fieldTexts" :key="key">
                <dt>{{ fieldLabel(prompt.entity, String(key)) }}</dt>
                <dd>{{ text }}</dd>
              </div>
            </dl>
            <div class="actions">
              <UiButton size="sm" variant="secondary" @click="openEditor({ prompt })">Изменить</UiButton>
              <UiButton size="sm" variant="ghost" :loading="busy === `prompt:${prompt.id}`" @click="confirmDelete = prompt">Удалить</UiButton>
            </div>
          </article>
        </div>

        <h3 class="group">Готовые шаблоны</h3>
        <div class="cards">
          <article v-for="preset in presets" :key="preset.id" class="card">
            <header>
              <strong>{{ preset.title }}</strong>
            </header>
            <p class="muted">{{ preset.goal }}</p>
            <p class="muted">Поля: {{ preset.fields.map(key => fieldLabel(preset.entity, key)).join(', ') }}</p>
            <p v-if="preset.general" class="text">{{ preset.general }}</p>
            <dl v-if="Object.keys(preset.fieldTexts).length" class="per-field">
              <div v-for="(text, key) in preset.fieldTexts" :key="key">
                <dt>{{ fieldLabel(preset.entity, String(key)) }}</dt>
                <dd>{{ text }}</dd>
              </div>
            </dl>
            <div class="actions">
              <UiButton size="sm" variant="secondary" @click="openEditor({ preset })">Сделать свой на основе</UiButton>
            </div>
          </article>
        </div>
      </template>

      <!-- Rules -->
      <template v-else-if="section === 'rules'">
        <UiCard title="Как собирается запрос к модели">
          <ol class="assembly">
            <li v-for="item in ASSEMBLY" :key="item.title">
              <div class="assembly-head">
                <strong>{{ item.title }}</strong>
                <UiBadge size="sm" :tone="item.tone">{{ item.badge }}</UiBadge>
              </div>
              <p class="muted">{{ item.text }}</p>
            </li>
          </ol>
        </UiCard>

        <UiCard v-for="item in rulesTexts" :key="item.text.id" :title="item.title">
          <template #actions>
            <UiBadge v-if="item.text.edited" tone="warning" size="sm">изменено</UiBadge>
          </template>
          <UiTextarea :model-value="draft(item.text)" :rows="14" :aria-label="item.title" @update:model-value="drafts = { ...drafts, [item.text.id]: $event ?? '' }" />
          <div class="actions">
            <UiButton :disabled="!dirty(item.text)" :loading="busy === item.text.id" @click="saveText(item.text, draft(item.text))">Сохранить</UiButton>
            <UiButton v-if="item.text.edited" variant="ghost" :loading="busy === item.text.id" @click="saveText(item.text, null)">Вернуть как было</UiButton>
          </div>
        </UiCard>

        <UiCard title="Гайды по видам товаров">
          <p class="muted">
            Вид выбирается по началу названия, затем по категории товара, затем по цепочке категорий. Гайд добавляется к правилам для товаров.
          </p>
          <UiField label="Вид товара" for="tpl-kind">
            <UiSelect
              id="tpl-kind"
              v-model="kind"
              :options="data.kinds.map((item) => ({ value: item.key, label: `${item.label}${data!.texts.guides[item.key]?.edited ? ' · изменено' : ''}` }))"
            />
          </UiField>
          <p v-if="kindInfo?.keywords.length" class="muted">Узнаётся по словам: {{ kindInfo.keywords.join(', ') }}</p>
          <template v-if="kindText">
            <UiTextarea :model-value="draft(kindText)" :rows="8" aria-label="Гайд" @update:model-value="drafts = { ...drafts, [kindText.id]: $event ?? '' }" />
            <div class="actions">
              <UiButton :disabled="!dirty(kindText)" :loading="busy === kindText.id" @click="saveText(kindText, draft(kindText))">Сохранить</UiButton>
              <UiButton v-if="kindText.edited" variant="ghost" :loading="busy === kindText.id" @click="saveText(kindText, null)">Вернуть как было</UiButton>
            </div>
          </template>
        </UiCard>
      </template>

      <!-- Try -->
      <UiCard v-else-if="section === 'try'" title="Проверить правила на товаре">
        <div class="admin-form">
          <UiField label="Ссылка на карточку или ID товара" for="tpl-product">
            <UiInput id="tpl-product" v-model="productInput" placeholder="https://gost.by/product/…" />
          </UiField>
          <UiField label="Требования задачи (необязательно)" for="tpl-extra">
            <UiTextarea id="tpl-extra" v-model="extraPrompt" :rows="2" placeholder="Например: в SEO-описании добавь «купить в Минске по низким ценам»" />
          </UiField>
          <div class="actions">
            <UiButton :loading="explaining" @click="explain">Показать запрос (бесплатно)</UiButton>
            <UiButton variant="secondary" :loading="previewing" :disabled="!status?.enabled" @click="runPreview">
              Отправить в модель (1 запрос + проверка)
            </UiButton>
          </div>
        </div>

        <div v-if="explained" class="result">
          <p v-if="explained.template">
            Вид товара: <strong>{{ explained.template.label }}</strong> — {{ BY[explained.template.by] }}<template v-if="explained.template.subject"> («{{ explained.template.subject }}»)</template>.
          </p>
          <p v-if="explained.phrases.length" class="muted">
            Вставятся дословно: <strong v-for="phrase in explained.phrases" :key="phrase">«{{ phrase }}» </strong>
          </p>
          <details v-for="(block, index) in explained.blocks" :key="index" :open="block.kind === 'task'">
            <summary>
              {{ block.title }} · {{ block.text.length }} симв.
              <UiBadge size="sm" :tone="BLOCK_BADGE[block.kind].tone">{{ BLOCK_BADGE[block.kind].label }}</UiBadge>
            </summary>
            <pre>{{ block.text }}</pre>
          </details>
        </div>

        <div v-if="preview" class="result">
          <p>Модель: <code>{{ preview.model }}</code><template v-if="preview.usage"> · токены: {{ preview.usage.promptTokens }} → {{ preview.usage.completionTokens }} (из кеша {{ preview.usage.cacheHitTokens }})</template></p>
          <UiTable
            :columns="[{ key: 'field', label: 'Поле' }, { key: 'old', label: 'Было' }, { key: 'new', label: 'Станет' }]"
            :rows="Object.entries(preview.changes).map(([key, change]) => ({ id: key, field: fieldLabel('PRODUCT', key), old: change.old ?? '—', new: change.new }))"
          />
          <ul v-if="Object.keys(preview.quality ?? {}).length" class="muted">
            <li v-for="(q, key) in preview.quality" :key="`q-${key}`">
              {{ fieldLabel('PRODUCT', String(key)) }}: {{ aiQualityLine(q) }}<template v-if="preview.warnings?.[String(key)]"> · {{ preview.warnings[String(key)] }}</template>
            </li>
          </ul>
          <div v-if="Object.keys(preview.rejected).length" class="rejected">
            <h3>Не запишется — отклонено проверками</h3>
            <ul>
              <li v-for="(item, key) in preview.rejected" :key="key">
                <strong>{{ fieldLabel('PRODUCT', String(key)) }}:</strong> {{ item.reason }}
                <span class="muted">«{{ item.value }}»</span>
              </li>
            </ul>
          </div>
        </div>
      </UiCard>

      <!-- Help -->
      <template v-else>
        <UiCard title="Поля: что это и где видно на сайте">
          <UiTable
            :columns="[
              { key: 'entity', label: '' },
              { key: 'label', label: 'Поле' },
              { key: 'where', label: 'Где видно' },
              { key: 'length', label: 'Длина' },
              { key: 'notes', label: 'Важно' }
            ]"
            :rows="data.fieldGuide.map((field) => ({ id: `${field.entity}:${field.key}`, ...field, entity: AI_ENTITY_LABEL[field.entity] }))"
          />
        </UiCard>

        <UiCard title="Проверки перед записью">
          <p class="muted">Поле, не прошедшее проверку, не пишется — остаётся старый текст, причина видна в задаче.</p>
          <dl class="checks">
            <div v-for="check in data.checks" :key="check.id">
              <dt>{{ check.title }}</dt>
              <dd>{{ check.detail }}</dd>
            </div>
          </dl>
          <details>
            <summary>Инструкция второй проверки (модель-проверяющий)</summary>
            <pre>{{ data.verifyPrompt }}</pre>
          </details>
        </UiCard>
      </template>
    </template>

    <!-- Template editor -->
    <UiModal v-model:open="editor.open" :title="editor.id ? 'Шаблон' : 'Новый шаблон'" size="lg">
      <UiAlert v-if="editor.error" tone="danger" class="block">{{ editor.error }}</UiAlert>
      <div class="admin-form">
        <div class="row">
          <UiField label="Название" required for="tpl-name">
            <UiInput id="tpl-name" v-model="editor.name" />
          </UiField>
          <UiField label="Для" for="tpl-entity">
            <UiSelect
              id="tpl-entity"
              v-model="editor.entity"
              :disabled="Boolean(editor.id)"
              :options="[
                { value: 'PRODUCT', label: 'Товаров' },
                { value: 'CATEGORY', label: 'Категорий' },
                { value: 'BRAND', label: 'Брендов' }
              ]"
            />
          </UiField>
        </div>
        <UiField label="Общая инструкция" hint="Ко всем полям шаблона. Можно оставить пустой, если хватает инструкций по полям." for="tpl-general">
          <UiTextarea id="tpl-general" v-model="editor.general" :rows="4" />
        </UiField>
        <div class="fields">
          <span class="label">Поля и инструкции к ним</span>
          <div v-for="field in fieldsOf(editor.entity)" :key="field.key" class="field" :class="{ 'is-on': editor.fields.includes(field.key) }">
            <UiCheckbox
              :model-value="editor.fields.includes(field.key)"
              @update:model-value="toggleEditorField(field.key, Boolean($event))"
            >
              <strong>{{ field.label }}</strong> <small>— {{ field.hint }}</small>
            </UiCheckbox>
            <UiTextarea
              v-if="editor.fields.includes(field.key)"
              v-model="editor.fieldTexts[field.key]"
              :rows="2"
              :aria-label="`Инструкция для поля ${field.label}`"
              placeholder="Что сделать с этим полем (необязательно)"
            />
          </div>
        </div>
        <p v-if="editorPhrases.length" class="muted">
          Вставятся дословно: <strong v-for="phrase in editorPhrases" :key="phrase">«{{ phrase }}» </strong>
        </p>
        <UiAlert v-if="editorPlaceholders" tone="warning">
          Остались [квадратные скобки] — их можно оставить в шаблоне, но перед запуском задачи мастер попросит их заполнить.
        </UiAlert>
      </div>
      <template #footer>
        <UiButton variant="ghost" @click="editor.open = false">Отмена</UiButton>
        <UiButton :loading="editor.saving" @click="saveEditor">Сохранить</UiButton>
      </template>
    </UiModal>

    <UiConfirm
      :open="Boolean(confirmDelete)"
      title="Удалить шаблон?"
      :busy="confirmDelete ? busy === `prompt:${confirmDelete.id}` : false"
      @update:open="confirmDelete = null"
      @confirm="deletePrompt"
    >
      Задачи, созданные по нему, сохранят свой текст.
    </UiConfirm>
  </div>
</template>

<style scoped>
.templates-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.group {
  margin: var(--space-2) 0 0;
  font-size: var(--text-base);
}

.cards {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
}

.card {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-2);
}

.card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.card p {
  margin: 0;
}

.text {
  font-size: var(--text-sm);
  white-space: pre-wrap;
}

.per-field {
  display: flex;
  flex-direction: column;
  margin: 0;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.per-field dt {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
}

.per-field dd {
  margin: 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: var(--space-2);
  gap: var(--space-2);
}

.assembly {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding-left: var(--space-5);
  gap: var(--space-3);
}

.assembly-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.assembly p {
  margin: var(--space-1) 0 0;
}

.result {
  display: flex;
  flex-direction: column;
  margin-top: var(--space-4);
  gap: var(--space-3);
}

pre {
  overflow: auto;
  max-height: 420px;
  margin: var(--space-2) 0 0;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: pre-wrap;
}

summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  cursor: pointer;
  font-weight: 600;
  gap: var(--space-2);
}

.muted {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.checks {
  display: grid;
  margin: 0 0 var(--space-3);
  gap: var(--space-2) var(--space-4);
  grid-template-columns: minmax(160px, 220px) 1fr;
}

.checks > div {
  display: contents;
}

dt {
  font-weight: 600;
}

dd {
  margin: 0;
  color: var(--text-muted);
}

.rejected h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-base);
}

.rejected ul {
  margin: 0;
  padding-left: var(--space-5);
}

code {
  font-family: var(--font-mono);
}

.block {
  margin-bottom: var(--space-4);
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

.fields .label {
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 600;
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

.field small {
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .checks,
  .row {
    grid-template-columns: 1fr;
  }
}
</style>
