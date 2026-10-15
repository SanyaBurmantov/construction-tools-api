import { getRequestURL, getRouterParam, proxyRequest } from 'h3'

/**
 * Browser → backend pass-through for `/api/*` when Nuxt itself receives those
 * requests (dev, or any setup without Caddy's `/api` route in front).
 *
 * **Session cookie.** The account session is an HttpOnly cookie with
 * `Path=/api`, so this route is the only part of Nuxt that ever sees it, and
 * it must forward it (and the backend's `Set-Cookie` back) — that is how the
 * browser signs in at all in dev. It is safe because nothing here is cached
 * or rendered: there is no route rule for `/api/**`, and the response goes
 * straight back to the one browser that asked. The cached, shared storefront
 * HTML cannot pick the cookie up either: page requests (`/`, `/catalog/…`)
 * are outside `/api`, so the browser never sends it with them, and SSR
 * fetches go to `apiBaseServer` directly, not through this route. Do not widen
 * the cookie's path to `/`, and do not add a cache rule for `/api/**`.
 *
 * h3 drops the incoming `Host` header, so the original one is passed as
 * `X-Forwarded-Host`: the backend's CSRF check compares a cookie request's
 * Origin against it.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const path = getRouterParam(event, 'path') || ''
  const requestUrl = getRequestURL(event)
  const baseUrl = String(config.apiBaseServer).replace(/\/$/, '')
  const target = `${baseUrl}/${path}${requestUrl.search}`

  return proxyRequest(event, target, {
    headers: {
      'x-forwarded-host': requestUrl.host,
      'x-forwarded-proto': requestUrl.protocol.replace(/:$/, ''),
    },
  })
})
