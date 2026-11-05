import { getRequestURL, sendRedirect } from 'h3'
import { legacyRedirect } from '../utils/legacy-urls'

/**
 * 301s the previous gost.by shops' addresses to ours (see
 * `utils/legacy-urls.ts`). Named `0.` so Nitro runs it before
 * `canonical-url.ts` — an old `/siz/` goes to its category in one hop instead
 * of being slash-stripped into another 404 first.
 */
export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const url = getRequestURL(event)
  const target = legacyRedirect(url.pathname, url.search)
  if (target) return sendRedirect(event, target, 301)
})
