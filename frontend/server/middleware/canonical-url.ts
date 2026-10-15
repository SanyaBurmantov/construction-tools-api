import { getRequestURL, sendRedirect } from 'h3'

/**
 * One URL per page: `/delivery/`, `/Delivery` and `/catalog//hoztovary/` all
 * answer 301 to the canonical form — lowercase, no trailing slash, single
 * slashes — with the query string kept. That is the form every
 * `rel=canonical`, the sitemap and the internal links use; before this the
 * variants answered 200 with a canonical pointing elsewhere, which splits
 * link weight and wastes crawl budget.
 *
 * A Nitro middleware rather than a Caddy rule so `npm run dev` behaves like
 * prod. Left alone: anything that is not a page — `/api` (proxied to the
 * backend in dev; Caddy takes it before us in prod), Nuxt/IPX internals
 * (`/_nuxt`, `/_ipx`, `/__nuxt_error`…), Vite's dev-server paths (`/@vite`,
 * `/@id`, `/node_modules`), dot-segments (`/.well-known`) and
 * every path whose last segment has an extension (sitemaps, robots.txt,
 * `_payload.json`, fonts, images). Percent-escapes are not case-folded: `%D0`
 * and `%d0` are the same byte, so there is nothing to gain from redirecting.
 */
const SKIP_PREFIX_RE = /^\/(?:api(?:\/|$)|_|\.|@|node_modules\/)/
const HAS_EXTENSION_RE = /\/[^/]*\.[^/]*$/

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return

  const url = getRequestURL(event)
  const path = url.pathname
  if (path === '/' || SKIP_PREFIX_RE.test(path) || HAS_EXTENSION_RE.test(path)) return

  let canonical = path
    // `//evil.example/` must never become the protocol-relative `//evil.example`.
    .replace(/\/{2,}/g, '/')
    .replace(/%[0-9a-fA-F]{2}|[A-Z]+/g, m => (m[0] === '%' ? m : m.toLowerCase()))
  if (canonical.length > 1) canonical = canonical.replace(/\/+$/, '') || '/'

  if (canonical === path) return
  return sendRedirect(event, canonical + url.search, 301)
})
