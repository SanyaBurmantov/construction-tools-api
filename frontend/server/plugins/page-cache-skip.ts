import { getRequestURL } from 'h3'
import { PAGE_CACHE_SKIP_HEADER } from '../storage/cacheable'

/**
 * A search result page is rendered on every request instead of cached: each
 * distinct `?search=` was its own entry, so a bot typing queries filled the
 * page cache and pushed real product pages out of it (audit 2026-10-30).
 *
 * Nitro's route-rule cache cannot skip by query, but the cache entry carries
 * the response headers, and both cache drivers refuse an entry marked with
 * `PAGE_CACHE_SKIP_HEADER` (server/storage/cacheable.ts). The header also
 * reaches the browser, which is harmless.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    const url = getRequestURL(event)
    if (url.pathname.startsWith('/catalog') && url.searchParams.has('search')) {
      response.headers = { ...response.headers, [PAGE_CACHE_SKIP_HEADER]: 'skip' }
    }
  })
})
