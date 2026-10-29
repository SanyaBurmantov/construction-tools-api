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

/**
 * The array stored under `key` — or `null` when storage cannot be read at all
 * (blocked, private mode), so a caller that re-reads before an edit keeps its
 * in-memory copy instead of replacing it with nothing.
 */
export function readStoredArray<T>(key: string, kind: Area = 'local'): T[] | null {
  const storage = area(kind)
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return null
  }
}

/** Calls `handler` when another tab changes `key` in localStorage. */
export function onStorageChange(key: string, handler: () => void) {
  if (!import.meta.client) return
  window.addEventListener('storage', (event) => {
    // `key === null` is another tab calling `localStorage.clear()`.
    if (event.key === key || event.key === null) handler()
  })
}
