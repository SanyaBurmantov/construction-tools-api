/**
 * Nitro keys the page cache by the request's **full URL**, query included, so
 * every `?utm_source=…`, `?yclid=…` and Yandex's per-click `?ysclid=…` was a
 * separate render and a separate entry on disk for the same HTML, and any
 * `/product/x?anything=1` let a crawler mint cache entries at will
 * (audit 2026-10-30). Before the router (and so before the cache) sees the
 * request, this middleware rewrites the URL it renders from:
 *
 * - tracking parameters are removed everywhere — the page does not depend on
 *   them, and the attribution plugin reads them in the browser from
 *   `window.location`, which this does not touch;
 * - a product page drops its whole query: nothing on it reads one.
 *
 * Search results (`/catalog?search=…`) keep their query and are rendered, but
 * not stored: see server/plugins/page-cache-skip.ts.
 */
const TRACKING_PARAM_RE = /^(?:utm_[a-z_]+|yclid|ysclid|gclid|gbraid|wbraid|fbclid|msclkid|_openstat|roistat|from)$/i
const SKIP_PREFIX_RE = /^\/(?:api(?:\/|$)|_|\.|@|node_modules\/)/

export function pageCacheUrl(url: string): string {
  const at = url.indexOf('?')
  if (at < 0) return url
  const path = url.slice(0, at)
  if (path.startsWith('/product/')) return path
  const params = new URLSearchParams(url.slice(at + 1))
  let changed = false
  for (const name of [...params.keys()]) {
    if (TRACKING_PARAM_RE.test(name)) {
      params.delete(name)
      changed = true
    }
  }
  if (!changed) return url
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const req = event.node.req
  const url = req.url || '/'
  if (SKIP_PREFIX_RE.test(url)) return
  const rewritten = pageCacheUrl(url)
  if (rewritten === url) return
  // `originalUrl` is what the cache key is built from; `_path` is what h3's
  // router and Nuxt's renderer read.
  req.url = rewritten
  req.originalUrl = rewritten
  event._path = rewritten
})
