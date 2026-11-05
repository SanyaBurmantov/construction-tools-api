import type { PlanArea, PlanItem, PlanStatus } from '~/types/api'

/** Vocabulary of «Планы» (`/admin/plans`). */
export const PLAN_AREA_LABELS: Record<PlanArea, string> = {
  SALES: 'Продажи',
  SEO: 'SEO и индексация',
  ADS: 'Реклама',
  CATALOG: 'Каталог и поставщики',
  CONTENT: 'Тексты и карточки',
  TECH: 'Техника и безопасность',
  OTHER: 'Другое',
}

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  TODO: 'Сделать',
  IN_PROGRESS: 'В работе',
  DONE: 'Сделано',
  DROPPED: 'Отменено',
}

export const PLAN_PRIORITY_LABELS: Record<number, string> = {
  1: 'Высокий',
  2: 'Обычный',
  3: 'Низкий',
}

export const planAreaOptions = Object.entries(PLAN_AREA_LABELS).map(([value, label]) => ({ value, label }))
export const planStatusOptions = Object.entries(PLAN_STATUS_LABELS).map(([value, label]) => ({ value, label }))
export const planPriorityOptions = [1, 2, 3].map(value => ({ value, label: PLAN_PRIORITY_LABELS[value]! }))

export function isPlanOpen(item: Pick<PlanItem, 'status'>): boolean {
  return item.status === 'TODO' || item.status === 'IN_PROGRESS'
}

/** Open and past its due date (the date is a calendar day, compared in local time). */
export function isPlanOverdue(item: Pick<PlanItem, 'status' | 'dueDate'>, now = new Date()): boolean {
  if (!item.dueDate || !isPlanOpen(item)) return false
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return new Date(`${item.dueDate.slice(0, 10)}T00:00:00`) < today
}

const number = new Intl.NumberFormat('ru-BY', { maximumFractionDigits: 2 })

/** «1 234,5 Br», «12 шт.». */
export function formatPlanValue(value: number | null | undefined, unit?: string): string {
  if (value == null) return '—'
  const shown = unit === 'BYN' ? 'Br' : unit
  return shown ? `${number.format(value)} ${shown}` : number.format(value)
}
