<script setup lang="ts">
/**
 * «ИИ-тексты → Отклонённое»: what the AI proposed and the site did not take,
 * side by side — on the left what is on the site now, on the right the
 * proposal with why it was refused — and an editor right there.
 *
 * - «Тексты»: fields an AI task wrote that the checks refused (the old text
 *   stayed). Edit the model's text and «Записать» — it is written and
 *   locked like an AI change (the task's rollback covers it) — or «Оставить
 *   как есть».
 * - «Категории»: products of the hidden fallback category the assistant
 *   could not place or was unsure about. Pick a category and save, or ask
 *   the assistant again.
 */
import type { AiEntity, AiSuggestion } from '~/types/ai'
import { AI_ENTITY_LABEL } from '~/types/ai'
import type { Paginated } from '~/types/api'
import type { CategoryOptionSource } from '~/utils/category-options'

type RejectedField = {
  key: string
  label: string
  maxLength: number
  reason: string
  current: string | null
  proposed: string
}
type RejectedItem = {
  id: string
  taskId: string
  taskName: string
  entity: AiEntity
  entityId: string
  entityName: string
  slug: string | null
  exists: boolean
  fields: RejectedField[]
}
type UnplacedRow = AiSuggestion & {
  product: {
    id: string
    name: string
    slug: string
    sku: string | null
    status: string
    brand: string | null
    category: { id: string, name: string }
    image: string | null
    specs: string[]
  }
}

const { adminFetch } = useAdminApi()
const { run, busy } = useAdminAction()

const section = ref<'texts' | 'categories'>('texts')
const totals = reactive({ texts: 0, categories: 0 })

/* ---- Texts ------------------------------------------------------------- */
const entity = ref<AiEntity | ''>('')
const items = ref<RejectedItem[]>([])
const textsPage = ref(1)
const textsPages = ref(1)
const textsLoading = ref(false)
/** The editor's text per `item:field`, starting from the model's proposal. */
const drafts = ref<Record<string, string>>({})

async function loadTexts() {
  textsLoading.value = true
  try {
    const response = await adminFetch<Paginated<RejectedItem>>('/ai/rejected', {
      params: compactParams({ entity: entity.value, page: textsPage.value }),
    })
    items.value = response.data
    textsPages.value = response.pagination.pages
    totals.texts = response.pagination.total
    drafts.value = Object.fromEntries(
      response.data.flatMap(item => item.fields.map(field => [`${item.id}:${field.key}`, field.proposed])),
    )
  } catch {
    items.value = []
  } finally {
    textsLoading.value = false
  }
}

watch(entity, () => {
  textsPage.value = 1
  void loadTexts()
})

const draftKey = (item: RejectedItem, field: RejectedField) => `${item.id}:${field.key}`

function writeField(item: RejectedItem, field: RejectedField) {
  return run(
    () => adminFetch(`/ai/rejected/${item.id}/apply`, {
      method: 'POST',
      body: { field: field.key, value: drafts.value[draftKey(item, field)] ?? '' },
    }),
    { key: `w:${draftKey(item, field)}`, error: 'Не удалось записать', success: 'Записано на сайт', after: loadTexts },
  )
}

function dismissField(item: RejectedItem, field: RejectedField) {
  return run(
    () => adminFetch(`/ai/rejected/${item.id}/dismiss`, { method: 'POST', body: { field: field.key } }),
    { key: `d:${draftKey(item, field)}`, error: 'Не удалось', success: 'Оставлено как есть', after: loadTexts },
  )
}

const entityLink = (item: RejectedItem) => {
  if (!item.slug) return null
  return item.entity === 'PRODUCT'
    ? `/product/${item.slug}`
    : item.entity === 'CATEGORY' ? `/catalog/${item.slug}` : `/brand/${item.slug}`
}

/* ---- Categories -------------------------------------------------------- */
const unplaced = ref<UnplacedRow[]>([])
const catsPage = ref(1)
const catsPages = ref(1)
const catsLoading = ref(false)
const allCategories = ref<CategoryOptionSource[]>([])
const picks = ref<Record<string, string>>({})

async function loadCategories() {
  catsLoading.value = true
  try {
    const response = await adminFetch<Paginated<UnplacedRow>>('/ai/assist/unplaced', {
      params: { page: catsPage.value },
    })
    unplaced.value = response.data
    catsPages.value = response.pagination.pages
    totals.categories = response.pagination.total
  } catch {
    unplaced.value = []
  } finally {
    catsLoading.value = false
  }
}

/** The assistant's candidates first, then the whole tree. */
function categoryOptions(row: UnplacedRow) {
  const candidates = (row.payload.candidates ?? []) as Array<{ id: string, path: string }>
  return [
    { value: '', label: 'Выберите категорию' },
    ...candidates.map(candidate => ({ value: candidate.id, label: `ИИ: ${candidate.path}` })),
    ...categoryTreeOptions(allCategories.value),
  ]
}
const pickOf = (row: UnplacedRow) => picks.value[row.id] ?? row.payload.to ?? ''

function place(row: UnplacedRow) {
  return run(
    () => adminFetch(`/ai/assist/suggestions/${row.id}/apply`, { method: 'POST', body: { categoryId: pickOf(row) } }),
    { key: `p:${row.id}`, error: 'Не удалось сохранить', success: 'Категория сохранена', after: loadCategories },
  )
}

function askAgain(row: UnplacedRow) {
  return run(
    () => adminFetch(`/ai/assist/suggestions/${row.id}`, { method: 'DELETE' }),
    { key: `r:${row.id}`, error: 'Не удалось', success: 'Помощник посмотрит товар снова', after: loadCategories },
  )
}

function setTextsPage(next: number) {
  textsPage.value = next
  void loadTexts()
}

function setCatsPage(next: number) {
  catsPage.value = next
  void loadCategories()
}

onMounted(() => {
  void loadTexts()
  void loadCategories()
  adminFetch<CategoryOptionSource[]>('/categories')
    .then((list) => { allCategories.value = list })
    .catch(() => { /* the candidates still work */ })
})
</script>

<template>
  <div class="rejected">
    <UiTabs
      :model-value="section"
      :tabs="[
        { value: 'texts', label: 'Тексты', count: totals.texts || null },
        { value: 'categories', label: 'Категории товаров', count: totals.categories || null }
      ]"
      @update:model-value="section = $event as 'texts' | 'categories'"
    />

    <!-- Texts -->
    <template v-if="section === 'texts'">
      <div class="toolbar">
        <UiSelect
          v-model="entity"
          size="sm"
          aria-label="Что показать"
          :options="[
            { value: '', label: 'Товары, категории и бренды' },
            { value: 'PRODUCT', label: 'Товары' },
            { value: 'CATEGORY', label: 'Категории' },
            { value: 'BRAND', label: 'Бренды' }
          ]"
        />
        <span class="muted">Поля, которые проверки не пустили на сайт: там остался старый текст.</span>
      </div>

      <UiSkeleton v-if="textsLoading && !items.length" :lines="6" height="18px" />
      <UiEmpty v-else-if="!items.length" icon="box" title="Отклонённых текстов нет" />

      <ul v-else class="list">
        <li v-for="item in items" :key="item.id" class="card">
          <header class="card-head">
            <a v-if="entityLink(item)" :href="entityLink(item)!" target="_blank" rel="noopener" class="name">{{ item.entityName }}</a>
            <strong v-else class="name">{{ item.entityName }}</strong>
            <UiBadge size="sm">{{ AI_ENTITY_LABEL[item.entity] }}</UiBadge>
            <span class="muted">задача «{{ item.taskName }}»</span>
            <UiButton
              v-if="item.entity === 'PRODUCT' && item.exists"
              size="sm"
              variant="ghost"
              :to="`/admin/products?edit=${item.entityId}`"
              target="_blank"
            >
              Открыть в редакторе товара
            </UiButton>
          </header>
          <UiAlert v-if="!item.exists" tone="warning">Запись удалена — записать некуда.</UiAlert>

          <section v-for="field in item.fields" :key="field.key" class="compare">
            <h4>{{ field.label }}</h4>
            <div class="sides">
              <div class="side">
                <span class="side-label">Сейчас на сайте</span>
                <p class="value" :class="{ empty: !field.current }">{{ field.current || 'пусто' }}</p>
              </div>
              <div class="side is-proposed">
                <span class="side-label">ИИ предложил — не прошло: <strong>{{ field.reason }}</strong></span>
                <UiTextarea
                  v-model="drafts[draftKey(item, field)]"
                  :rows="field.key === 'descriptionFull' || field.key === 'description' ? 8 : 3"
                  :aria-label="`Текст поля ${field.label}`"
                />
                <small class="muted">{{ (drafts[draftKey(item, field)] ?? '').length }} / {{ field.maxLength }}</small>
              </div>
            </div>
            <div class="actions">
              <UiButton
                size="sm"
                :disabled="!item.exists || !(drafts[draftKey(item, field)] ?? '').trim()"
                :loading="busy === `w:${draftKey(item, field)}`"
                @click="writeField(item, field)"
              >
                Записать на сайт
              </UiButton>
              <UiButton
                size="sm"
                variant="ghost"
                :loading="busy === `d:${draftKey(item, field)}`"
                @click="dismissField(item, field)"
              >
                Оставить как есть
              </UiButton>
              <UiButton
                v-if="drafts[draftKey(item, field)] !== field.proposed"
                size="sm"
                variant="ghost"
                @click="drafts = { ...drafts, [draftKey(item, field)]: field.proposed }"
              >
                Вернуть текст ИИ
              </UiButton>
            </div>
          </section>
        </li>
      </ul>
      <UiPagination :page="textsPage" :pages="textsPages" :total="totals.texts" @change="setTextsPage" />
    </template>

    <!-- Categories -->
    <template v-else>
      <p class="muted">
        Товары из скрытой «Неразобранные товары поставщиков», которым помощник не нашёл категорию или не был уверен. Сохранённая категория закрепляется: перепарсинг её не вернёт.
      </p>
      <UiSkeleton v-if="catsLoading && !unplaced.length" :lines="6" height="18px" />
      <UiEmpty v-else-if="!unplaced.length" icon="box" title="Все товары разобраны" />

      <ul v-else class="list">
        <li v-for="row in unplaced" :key="row.id" class="card">
          <header class="card-head">
            <img v-if="row.product.image" :src="row.product.image" alt="" class="thumb" loading="lazy">
            <a :href="`/product/${row.product.slug}`" target="_blank" rel="noopener" class="name">{{ row.product.name }}</a>
            <span v-if="row.product.brand" class="muted">{{ row.product.brand }}</span>
            <span v-if="row.product.sku" class="muted">арт. {{ row.product.sku }}</span>
            <UiButton size="sm" variant="ghost" :to="`/admin/products?edit=${row.product.id}`" target="_blank">
              Открыть в редакторе товара
            </UiButton>
          </header>
          <div class="sides">
            <div class="side">
              <span class="side-label">Сейчас</span>
              <p class="value">{{ row.product.category.name }}</p>
              <p v-if="row.product.specs.length" class="muted specs">{{ row.product.specs.join(' · ') }}</p>
            </div>
            <div class="side is-proposed">
              <span class="side-label">
                {{ row.status === 'PENDING' ? 'ИИ не уверен' : 'ИИ не подобрал' }}<template v-if="row.payload.reason">: <strong>{{ row.payload.reason }}</strong></template>
              </span>
              <p v-if="row.payload.toPath" class="value">→ {{ row.payload.toPath }}</p>
              <UiSelect
                :model-value="pickOf(row)"
                size="sm"
                aria-label="Категория"
                :options="categoryOptions(row)"
                @update:model-value="picks = { ...picks, [row.id]: String($event) }"
              />
            </div>
          </div>
          <div class="actions">
            <UiButton size="sm" :disabled="!pickOf(row)" :loading="busy === `p:${row.id}`" @click="place(row)">Сохранить категорию</UiButton>
            <UiButton size="sm" variant="ghost" :loading="busy === `r:${row.id}`" @click="askAgain(row)">Спросить ИИ ещё раз</UiButton>
          </div>
        </li>
      </ul>
      <UiPagination :page="catsPage" :pages="catsPages" :total="totals.categories" @change="setCatsPage" />
    </template>
  </div>
</template>

<style scoped>
.rejected {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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
  gap: var(--space-4);
  list-style: none;
}

.card {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-3);
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.name {
  color: var(--text-strong);
  font-weight: 700;
}

.thumb {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  object-fit: contain;
}

.compare {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-2);
}

.compare h4 {
  margin: 0;
  font-size: var(--text-sm);
}

.sides {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.side {
  display: flex;
  flex-direction: column;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  gap: var(--space-2);
}

.side.is-proposed {
  background: var(--brand-soft);
}

.side-label {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.side-label strong {
  color: var(--danger);
}

.value {
  margin: 0;
  font-size: var(--text-sm);
  white-space: pre-wrap;
}

.value.empty {
  color: var(--text-muted);
  font-style: italic;
}

.specs {
  font-size: var(--text-xs);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

@media (max-width: 760px) {
  .sides {
    grid-template-columns: 1fr;
  }
}
</style>
