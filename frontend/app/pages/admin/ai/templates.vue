<script setup lang="ts">
import type { AiExplain, AiPreview, AiTemplateText, AiTemplates } from '~/types/ai'

/**
 * «Шаблоны и проверки»: everything an AI task sends and checks, on screen
 * and editable — no magic. An edit applies to the next task (a task keeps
 * the instruction it was created with) and to every preview.
 */
definePageMeta({ layout: 'admin' })

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()
const { status, loadStatus } = useAiStatus()
const { apiBase } = useSite()

const data = ref<AiTemplates | null>(null)
const loadError = ref('')
async function load() {
  try {
    data.value = await adminFetch<AiTemplates>('/ai/templates')
    loadError.value = ''
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить шаблоны')
  }
}
onMounted(() => {
  void load()
  void loadStatus()
})

/* ---- Editing ------------------------------------------------------------ */
const drafts = ref<Record<string, string>>({})
const draft = (text: AiTemplateText) => drafts.value[text.id] ?? text.text
const dirty = (text: AiTemplateText) => drafts.value[text.id] !== undefined && drafts.value[text.id] !== text.text

const { run, busy } = useAdminAction()
async function save(text: AiTemplateText, value: string | null) {
  const result = await run(
    () => adminFetch<AiTemplates['texts']>(`/ai/templates/${encodeURIComponent(text.id)}`, {
      method: 'PUT',
      body: { text: value },
    }),
    {
      key: text.id,
      error: 'Не удалось сохранить',
      success: value === null ? 'Вернули текст по умолчанию' : 'Сохранено — применится к новым задачам и предпросмотру',
    },
  )
  if (result && data.value) {
    data.value.texts = result
    drafts.value = Object.fromEntries(
      Object.entries(drafts.value).filter(([id]) => id !== text.id),
    )
  }
}

const kind = ref('')
const kindText = computed(() => (kind.value && data.value ? data.value.texts.guides[kind.value] : null))
const kindInfo = computed(() => data.value?.kinds.find((item) => item.key === kind.value))
watch(data, (value) => {
  if (value && !kind.value) kind.value = value.kinds[0]?.key ?? ''
})

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

const fieldLabel = (key: string) => status.value?.fields.PRODUCT?.find((field) => field.key === key)?.label ?? key

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
        fields: (status.value?.fields.PRODUCT ?? []).map((field) => field.key),
      },
    })
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось получить ответ модели'))
  } finally {
    previewing.value = false
  }
}

/* ---- Frameworks for the SEO specialist ---------------------------------- */
const checkCard = ref<HTMLElement | null>(null)
function useScaffold(text: string) {
  extraPrompt.value = text
  checkCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  toast.success('Каркас подставлен — заполните [скобки] и проверьте на товаре')
}

async function saveScaffold(scaffold: AiTemplates['scaffolds'][number]) {
  await run(
    () => adminFetch('/ai/prompts', {
      method: 'POST',
      body: { name: scaffold.title, entity: scaffold.entity, text: scaffold.text },
    }),
    {
      key: `scaffold:${scaffold.id}`,
      error: 'Не удалось сохранить промпт',
      success: 'Сохранено в «ИИ · Задачи → Промпты» — отредактируйте [скобки] там',
    },
  )
}

const entityLabel = (entity: string) => (entity === 'PRODUCT' ? 'Товары' : 'Категории')

const BY: Record<NonNullable<AiExplain['template']>['by'], string> = {
  name: 'по началу названия',
  category: 'по категории товара',
  chain: 'по цепочке категорий',
  default: 'ни один вид не подошёл — общий шаблон',
}
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="ИИ · Шаблоны и проверки"
      description="Что отправляется в модель и что проверяется перед записью. Правки применяются к новым задачам и к предпросмотру; уже созданная задача работает со своим текстом."
    >
      <UiButton variant="secondary" to="/admin/ai/products">Выбрать товары</UiButton>
      <UiButton variant="secondary" to="/admin/ai/tasks">Задачи</UiButton>
    </AdminPageHead>

    <AdminAiStatusLine :status="status" />

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>
    <UiSkeleton v-else-if="!data" height="320px" radius="var(--radius-md)" />

    <template v-else>
      <!-- Try it on a product first: that is what the rest explains. -->
      <div ref="checkCard" />
      <UiCard title="Проверить на товаре">
        <div class="admin-form">
          <UiField label="Ссылка на карточку или ID товара" for="tpl-product">
            <UiInput id="tpl-product" v-model="productInput" placeholder="https://gost.by/product/…" />
          </UiField>
          <UiField label="Дополнительно к шаблону (необязательно)" for="tpl-extra">
            <UiTextarea id="tpl-extra" v-model="extraPrompt" :rows="2" />
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
            Шаблон: <strong>{{ explained.template.label }}</strong> — {{ BY[explained.template.by] }}<template v-if="explained.template.subject"> («{{ explained.template.subject }}»)</template>.
          </p>
          <details v-for="message in explained.messages" :key="message.role">
            <summary>{{ message.role === 'system' ? 'Инструкция (system)' : 'Данные товара (user)' }} · {{ message.content.length }} симв.</summary>
            <pre>{{ message.content }}</pre>
          </details>
        </div>

        <div v-if="preview" class="result">
          <p>Модель: <code>{{ preview.model }}</code><template v-if="preview.usage"> · токены: {{ preview.usage.promptTokens }} → {{ preview.usage.completionTokens }} (из кеша {{ preview.usage.cacheHitTokens }})</template></p>
          <UiTable
            :columns="[{ key: 'field', label: 'Поле' }, { key: 'old', label: 'Было' }, { key: 'new', label: 'Станет' }]"
            :rows="Object.entries(preview.changes).map(([key, change]) => ({ id: key, field: fieldLabel(key), old: change.old ?? '—', new: change.new }))"
          />
          <div v-if="Object.keys(preview.rejected).length" class="rejected">
            <h3>Не запишется — отклонено проверками</h3>
            <ul>
              <li v-for="(item, key) in preview.rejected" :key="key">
                <strong>{{ fieldLabel(String(key)) }}:</strong> {{ item.reason }}
                <span class="muted">«{{ item.value }}»</span>
              </li>
            </ul>
          </div>
        </div>
      </UiCard>

      <UiCard title="Каркасы промптов">
        <p class="muted">
          Готовые заготовки под типовые задачи. Они дополняют встроенные правила — повторять их не нужно. Заполните места в [квадратных скобках].
        </p>
        <div class="scaffolds">
          <article v-for="scaffold in data.scaffolds" :key="scaffold.id" class="scaffold">
            <header>
              <strong>{{ scaffold.title }}</strong>
              <UiBadge size="sm" tone="neutral">{{ entityLabel(scaffold.entity) }}</UiBadge>
            </header>
            <p class="muted">{{ scaffold.goal }}</p>
            <p class="muted">Поля: {{ scaffold.fields.map((key) => data!.fieldGuide.find((f) => f.entity === scaffold.entity && f.key === key)?.label ?? key).join(', ') }}</p>
            <pre>{{ scaffold.text }}</pre>
            <div class="actions">
              <UiButton v-if="scaffold.entity === 'PRODUCT'" size="sm" variant="secondary" @click="useScaffold(scaffold.text)">Подставить в проверку</UiButton>
              <UiButton size="sm" variant="ghost" :loading="busy === `scaffold:${scaffold.id}`" @click="saveScaffold(scaffold)">Сохранить в «Промпты»</UiButton>
            </div>
          </article>
        </div>
      </UiCard>

      <UiCard title="Поля: что это и где видно на сайте">
        <UiTable
          :columns="[
            { key: 'entity', label: '' },
            { key: 'label', label: 'Поле' },
            { key: 'where', label: 'Где видно' },
            { key: 'length', label: 'Длина' },
            { key: 'notes', label: 'Важно' }
          ]"
          :rows="data.fieldGuide.map((field) => ({ id: `${field.entity}:${field.key}`, ...field, entity: entityLabel(field.entity) }))"
        />
      </UiCard>

      <UiCard v-for="text in [data.texts.productRules, data.texts.categoryRules]" :key="text.id" :title="text.id === 'product-rules' ? 'Общие правила для товаров' : 'Общие правила для категорий'">
        <template #actions>
          <UiBadge v-if="text.edited" tone="warning" size="sm">изменено</UiBadge>
        </template>
        <UiTextarea :model-value="draft(text)" :rows="14" @update:model-value="drafts = { ...drafts, [text.id]: $event ?? '' }" />
        <div class="actions">
          <UiButton :disabled="!dirty(text)" :loading="busy === text.id" @click="save(text, draft(text))">Сохранить</UiButton>
          <UiButton v-if="text.edited" variant="ghost" :loading="busy === text.id" @click="save(text, null)">Вернуть как было</UiButton>
        </div>
      </UiCard>

      <UiCard title="Гайды по видам товаров">
        <p class="muted">
          Вид выбирается по началу названия, затем по категории товара, затем по цепочке категорий. Гайд добавляется к общим правилам.
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
          <UiTextarea :model-value="draft(kindText)" :rows="8" @update:model-value="drafts = { ...drafts, [kindText.id]: $event ?? '' }" />
          <div class="actions">
            <UiButton :disabled="!dirty(kindText)" :loading="busy === kindText.id" @click="save(kindText, draft(kindText))">Сохранить</UiButton>
            <UiButton v-if="kindText.edited" variant="ghost" :loading="busy === kindText.id" @click="save(kindText, null)">Вернуть как было</UiButton>
          </div>
        </template>
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
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  flex-wrap: wrap;
  margin-top: var(--space-3);
  gap: var(--space-2);
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
  cursor: pointer;
  font-weight: 600;
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

.scaffolds {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
}

.scaffold {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  gap: var(--space-2);
}

.scaffold header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.scaffold p {
  margin: 0;
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

@media (max-width: 640px) {
  .checks {
    grid-template-columns: 1fr;
  }
}
</style>
