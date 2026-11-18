/**
 * Why a fetch counted as «API не ответил», in a few words for /admin/errors.
 *
 * The technical-works screen hides the cause, and 39 of them on 16–17.11
 * could not be told apart afterwards: a 429 from the per-address limit, a 5xx
 * from Caddy, or a request that never got an answer. The browser's report of
 * the screen carries this string, so the next batch says which it was.
 */
export function outageCause(error: unknown): string {
  if (!error || typeof error !== 'object') return 'нет ответа'
  const candidate = error as {
    statusCode?: unknown
    status?: unknown
    response?: { status?: unknown }
    name?: unknown
    message?: unknown
    cause?: unknown
  }
  const status = [candidate.statusCode, candidate.status, candidate.response?.status]
    .find(value => typeof value === 'number' && value > 0)
  if (typeof status === 'number') return `HTTP ${status}`

  // ofetch wraps the network failure: «[GET] "/api/…": <no response> Failed to fetch».
  const inner = candidate.cause && typeof candidate.cause === 'object'
    ? candidate.cause as { name?: unknown, message?: unknown }
    : undefined
  const name = typeof inner?.name === 'string' ? inner.name : typeof candidate.name === 'string' ? candidate.name : ''
  const message = typeof inner?.message === 'string' ? inner.message : typeof candidate.message === 'string' ? candidate.message : ''
  // Query strings may carry a token; the path is already in the report.
  const text = `${name}${name && message ? ': ' : ''}${message}`.replace(/\?[^\s"']*/g, '').trim()
  return `нет ответа${text ? `: ${text}` : ''}`.slice(0, 200)
}
