/** Shapes of `/admin/ai/*` (backend `src/ai/`). */
import type { ProductStatus } from '~/utils/product-status'

export type AiEntity = 'PRODUCT' | 'CATEGORY'
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

export type AiPrompt = {
  id: string
  name: string
  entity: AiEntity
  text: string
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
  model: string
  batchSize: number
  scheduledAt: string
  pausedUntil: string | null
  lastError: string | null
  total: number
  processed: number
  applied: number
  failed: number
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
  error: string | null
  updatedAt: string
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
