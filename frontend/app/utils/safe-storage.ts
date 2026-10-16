/**
 * Browser storage that never throws.
 *
 * `localStorage`/`sessionStorage` throw in a private window, with blocked site
 * data or a full quota. Every store used to wrap its own copy of the same
 * `getItem` / `JSON.parse` / `Array.isArray` / try-catch; a cart or a promo
 * code must keep working — just without persistence — when storage is gone.
 */
type Area = 'local' | 'session'

function area(kind: Area): Storage | null {
  if (!import.meta.client) return null
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function readJson<T>(key: string, kind: Area = 'local'): T | null {
  try {
    const raw = area(kind)?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** An array stored under `key`, or `[]` for anything missing or malformed. */
export function readArray<T>(key: string, kind: Area = 'local'): T[] {
  const value = readJson<unknown>(key, kind)
  return Array.isArray(value) ? (value as T[]) : []
}

export function writeJson(key: string, value: unknown, kind: Area = 'local') {
  try {
    area(kind)?.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or blocked storage — the in-memory state still works.
  }
}

export function removeStored(key: string, kind: Area = 'local') {
  try {
    area(kind)?.removeItem(key)
  } catch {
    // Nothing to remove when storage is unavailable.
  }
}
