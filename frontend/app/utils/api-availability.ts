/**
 * Tells «API не ответил» apart from «ответил, но пусто».
 *
 * The storefront fetches softly on purpose: a failed rail degrades to an empty
 * rail so the cached home page always renders. That is right when a query
 * legitimately matches nothing, and wrong during an outage — with the database
 * down every request fails the same way and the visitor is shown a shop with
 * nothing in it, which reads as «у них ничего нет», not as «сайт чинят».
 *
 * Unavailable means: no answer at all (connection refused, DNS, timeout — an
 * `ofetch` rejection without a status) or a 5xx from the API or from Caddy in
 * front of it. A 4xx is the API working and saying no, so it is not an outage —
 * except 429: «слишком много запросов» is the API refusing to answer, and
 * rendering it as «не найдено» would tell search engines the page is gone.
 */
export function isApiUnavailable(error: unknown): boolean {
  if (!error) return false

  const candidate = error as {
    statusCode?: number
    status?: number
    response?: { status?: number }
  }
  const status = candidate.statusCode ?? candidate.status ?? candidate.response?.status

  if (typeof status === 'number') return status >= 500 || status === 429

  return true
}

/** The page shown instead of an empty storefront while the API is down. */
export function apiUnavailableError() {
  return createError({
    statusCode: 503,
    statusMessage: 'Магазин временно недоступен',
    message: 'Мы уже чиним. Обновите страницу через пару минут.',
    fatal: true,
  })
}
