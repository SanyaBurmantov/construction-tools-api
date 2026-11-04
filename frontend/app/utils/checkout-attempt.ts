/**
 * One idempotency key per checkout attempt (`POST /orders` → `idempotencyKey`).
 * The key lives in this tab's sessionStorage until an order is confirmed, so a
 * retry after a lost response — a second press, a reload, a flaky mobile
 * network — gets the order the first request already created instead of a
 * duplicate. A refused attempt (409 prices changed, 400 minimum) created
 * nothing, so keeping the key for the corrected retry is harmless.
 */
const KEY = 'checkout-attempt'

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function checkoutAttemptKey(): string {
  const stored = readJson<string>(KEY, 'session')
  if (stored) return stored
  const key = newKey()
  writeJson(KEY, key, 'session')
  return key
}

/** After the order is confirmed: the next checkout is a new attempt. */
export function finishCheckoutAttempt() {
  removeStored(KEY, 'session')
}
