/** Shapes of `/admin/ai/*` (backend `src/ai/`). */
import type { ProductStatus } from '~/utils/product-status'

export type AiEntity = 'PRODUCT' | 'CATEGORY' | 'BRAND'

export const AI_ENTITY_LABEL: Record<AiEntity, string> = { PRODUCT: 'Товары', CATEGORY: 'Категории', BRAND: 'Бренды' }
/** «товаров» / «категорий» / «брендов». */
export const AI_ENTITY_GENITIVE: Record<AiEntity, string> = { PRODUCT: 'товаров', CATEGORY: 'категорий', BRAND: 'брендов' }
export type AiTaskStatus = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'DONE' | 'CANCELLED'
export type AiTaskItemStatus = 'PENDING' | 'APPLIED' | 'UNCHANGED' | 'FAILED' | 'REVERTED'

export type AiFieldDef = { key: string, label: string, maxLength: number, hint: string }

export type AiStatus = {
  enabled: boolean
  /** 'DeepSeek' | 'OpenRouter', null when no key is set. */
  provider: string | null
  defaultModel: string
  activeTasks: number
  quota: {
    isFreeTier: boolean
    dailyLimit: number | null
    dailyUsed: number | null
    dailyRemaining: number | null
    /** Paid key: what is left, e.g. "12.40 USD". */
    balance: string | null
  } | null
  fields: Record<AiEntity, AiFieldDef[]>
}

export type AiModel = { id: string, name: string, contextLength: number }

/** A saved template: the general instruction, the fields it fills, one instruction per field. */
export type AiPrompt = {
  id: string
  name: string
  entity: AiEntity
  text: string
  fields: string[]
  fieldTexts: Record<string, string> | null
  createdAt: string
  updatedAt: string
}

export type AiProductRow = {
  id: string
  name: string
  slug: string
  sku: string | null
  status: ProductStatus
  stockStatus: string | null
  image: string | null
  aiLockedFields: string[]
  priceValue: number | null
  createdAt: string
  brand: { id: string, name: string } | null
  category: { id: string, name: string } | null
  lengths: Record<string, number>
}

export type AiCategoryRow = {
  id: string
  name: string
  slug: string
  level: number
  isVisible: boolean
  parent: { id: string, name: string } | null
  _count: { products: number, children: number }
  lengths: Record<string, number>
}

export type AiBrandRow = {
  id: string
  name: string
  slug: string
  logo: string | null
  country: string | null
  /** Published products — a brand without them has no page worth a text. */
  products: number
  lengths: Record<string, number>
}

/** What the wizard turns into a task: picked rows, or the whole filter. */
export type AiSelection =
  | { mode: 'ids', ids: string[], count: number }
  | { mode: 'filter', filter: Record<string, string>, count: number }

export type AiTask = {
  id: string
  name: string
  entity: AiEntity
  status: AiTaskStatus
  fields: string[]
  promptId: string | null
  prompt: { id: string, name: string } | null
  promptText: string
  /** The admin's own part: general instruction and one per field. */
  promptParts: { general?: string, fields?: Record<string, string> } | null
  model: string
  batchSize: number
  scheduledAt: string
  pausedUntil: string | null
  lastError: string | null
  total: number
  processed: number
  applied: number
  failed: number
  /** Tokens billed for the task (batches only, not previews). */
  promptTokens?: number
  completionTokens?: number
  cacheHitTokens?: number
  createdBy: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  counts?: Partial<Record<AiTaskItemStatus, number>>
}

export type AiFieldChange = { old: string | null, new: string }

export type AiTaskItem = {
  id: string
  taskId: string
  entityId: string
  entityName: string
  status: AiTaskItemStatus
  attempts: number
  changes: Record<string, AiFieldChange> | null
  response: Record<string, unknown> | null
  /** Fields the checks refused to write, with the reason. */
  rejected: Record<string, string> | null
  /** Written, but worth a look (a near-copy of a sibling variant's text). */
  warnings: Record<string, string> | null
  error: string | null
  updatedAt: string
}

/** `POST /ai/preview`: what a task would write, and what the checks refuse. */
export type AiPreview = {
  model: string
  template: string | null
  changes: Record<string, AiFieldChange>
  rejected: Record<string, { reason: string, value: string }>
  usage?: { promptTokens: number, completionTokens: number, cacheHitTokens: number }
  /** The quoted phrases that pass the checks verbatim. */
  phrases?: string[]
  raw: string
}

export const AI_TASK_STATUS: Record<AiTaskStatus, { label: string, tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' }> = {
  QUEUED: { label: 'В очереди', tone: 'info' },
  RUNNING: { label: 'Выполняется', tone: 'brand' },
  PAUSED: { label: 'Пауза', tone: 'warning' },
  DONE: { label: 'Готово', tone: 'success' },
  CANCELLED: { label: 'Отменена', tone: 'neutral' },
}

export const AI_ITEM_STATUS: Record<AiTaskItemStatus, { label: string, tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' }> = {
  PENDING: { label: 'Ожидает', tone: 'info' },
  APPLIED: { label: 'Обновлено', tone: 'success' },
  UNCHANGED: { label: 'Без изменений', tone: 'neutral' },
  FAILED: { label: 'Ошибка', tone: 'danger' },
  REVERTED: { label: 'Откачено', tone: 'warning' },
}

/** What the shared picker screen needs of a row, product or category. */
export type AiPickerRow = {
  id: string
  name: string
  lengths: Record<string, number>
  aiLockedFields?: string[]
}

/** One editable text of «Шаблоны и проверки» over its code default. */
export type AiTemplateText = { id: string, text: string, default: string, edited: boolean }

/** `GET /ai/templates`: what the tasks send and the checks they run. */
export type AiTemplates = {
  texts: {
    productRules: AiTemplateText
    categoryRules: AiTemplateText
    brandRules: AiTemplateText
    guides: Record<string, AiTemplateText>
  }
  kinds: Array<{ key: string, label: string, keywords: string[] }>
  checks: Array<{ id: string, title: string, detail: string }>
  verifyPrompt: string
  /** What each field is and where it is seen — for whoever writes prompts. */
  fieldGuide: Array<{ entity: AiEntity, key: string, label: string, where: string, length: string, notes: string }>
  /** Built-in templates; [в скобках] — what to fill in. */
  presets: AiPreset[]
}

/** A built-in template (backend `ai-scaffolds.ts`). */
export type AiPreset = {
  id: string
  title: string
  entity: AiEntity
  goal: string
  fields: string[]
  general: string
  fieldTexts: Record<string, string>
}

/** One block of the instruction as the model gets it. */
export type AiPromptBlock = {
  kind: 'fixed' | 'rules' | 'guide' | 'task' | 'data'
  title: string
  text: string
}

/** `POST /ai/templates/explain`: the guide a record gets and the exact messages. */
export type AiExplain = {
  template: { key: string, label: string, by: 'name' | 'category' | 'chain' | 'default', subject: string } | null
  blocks: AiPromptBlock[]
  phrases: string[]
  messages: Array<{ role: string, content: string }>
}

/** The admin's instruction, as the wizard and the template editor hold it. */
export type AiInstruction = {
  general: string
  fieldTexts: Record<string, string>
}

/** Phrases of two words or more in quotes — the same rule as backend `ai-phrases.ts`. */
export function quotedPhrases(texts: string[]): string[] {
  const found = new Set<string>()
  const pattern = /«([^«»\n]{3,200})»|"([^"\n]{3,200})"|“([^“”\n]{3,200})”|„([^„“\n]{3,200})“/g
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      const phrase = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').replace(/\s+/g, ' ').trim()
      if (/\s/.test(phrase) && !/[[\]]/.test(phrase)) found.add(phrase)
    }
  }
  return [...found]
}

/** «[впишите запрос]» left in a template — the model would get it literally. */
export function hasPlaceholders(texts: string[]): boolean {
  return texts.some(text => /\[[^\]\n]{2,80}\]/.test(text))
}

/* ---- The AI assistant (`/admin/ai/assist`) ------------------------------- */

export type AiAssistJobKey =
  | 'autopilot' | 'categorize' | 'synonyms' | 'leads'
  | 'specs' | 'duplicates' | 'landings' | 'variants'

export type AiAssistJob = {
  key: AiAssistJobKey
  title: string
  description: string
  unit: string
  settings: { enabled: boolean, daily: number, template?: string, fields?: string[] }
  usage: {
    day: string
    items: number
    requests: number
    promptTokens: number
    completionTokens: number
    lastRunAt?: string
    lastResult?: string
  }
}

export type AiSuggestionKind = 'CATEGORY' | 'SYNONYM' | 'SPEC_MERGE' | 'DUPLICATE' | 'VARIANT'
export type AiSuggestionStatus = 'PENDING' | 'APPLIED' | 'REJECTED' | 'REVERTED' | 'INFO'

export type AiAssistOverview = {
  enabled: boolean
  jobs: AiAssistJob[]
  pending: Partial<Record<AiSuggestionKind, number>>
  autoAppliedCategories: number
  landings: { published: number, unpublished: number }
  presets: Array<{ id: string, title: string }>
}

export type AiSuggestion = {
  id: string
  kind: AiSuggestionKind
  key: string
  title: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the shape is per kind; each view reads its own
  payload: Record<string, any>
  status: AiSuggestionStatus
  auto: boolean
  model: string | null
  createdAt: string
  decidedAt: string | null
  decidedBy: string | null
}

export type AiLanding = {
  id: string
  h1: string
  description: string
  seoTitle: string
  seoDescription: string
  isPublished: boolean
  rejected: Record<string, string> | null
  productCount: number
  updatedAt: string
  brand: { id: string, name: string, slug: string }
  category: { id: string, name: string, slug: string }
}

/** A verdict on a /admin/duplicates group, keyed `signal:key`. */
export type AiDuplicateVerdict = {
  productIds: string[]
  verdict: 'same' | 'different' | 'unsure'
  reason: string
  at: string
}
