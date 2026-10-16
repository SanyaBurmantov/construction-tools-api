/**
 * Formatting particular to `/admin/parsing` and its panels. Timestamps
 * themselves go through `formatDateTime` from `format-datetime.ts` — the same
 * one the rest of the admin uses.
 */
import type { ParserSourceOverview, SourceDraft } from '~/types/parsing'

/** "5 мин назад" reads faster than a timestamp when you're checking liveness. */
export function formatAgo(iso: string | null | undefined) {
  if (!iso) return 'ещё не было'
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'только что'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return `${Math.round(hours / 24)} дн назад`
}

export function formatDuration(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} мс`
  if (ms < 60_000) return `${Math.round(ms / 1000)} с`
  return `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с`
}

/** Badge tone and wording for a job's health, shared by the control and health panels. */
export const HEALTH_TONE: Record<string, 'success' | 'info' | 'danger' | 'warning'> = {
  OK: 'success',
  RUNNING: 'info',
  ERROR: 'danger',
  STALE: 'warning',
}

export const HEALTH_LABEL: Record<string, string> = {
  OK: 'В норме',
  RUNNING: 'Работает',
  ERROR: 'Ошибка',
  STALE: 'Молчит',
}

/** Queue row status → badge tone; the category queue uses the same statuses. */
export const QUEUE_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  DONE: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
  SKIPPED: 'neutral',
}

/**
 * A source's settings as the form edits them. The page seeds its drafts with
 * it and the control panel compares against it, so the two agree on what
 * «изменено» means.
 */
export function draftFromSource(source: ParserSourceOverview): SourceDraft {
  return {
    batchLimit: source.batchLimit,
    requestDelayMs: source.requestDelayMs,
    maxPages: source.maxPages,
    categoryBatchLimit: source.categoryBatchLimit ?? 0,
    categoryIncludeRegex: source.categoryFilters.include,
    categoryExcludeRegex: source.categoryFilters.exclude,
  }
}

export function sameDraft(a: SourceDraft, b: SourceDraft) {
  return (Object.keys(a) as Array<keyof SourceDraft>).every(key => a[key] === b[key])
}

/** Badge tone of an HTTP status in the audit and error logs. */
export const httpStatusTone = (code: number) =>
  code >= 500 ? 'danger' : code >= 400 ? 'warning' : 'success'
