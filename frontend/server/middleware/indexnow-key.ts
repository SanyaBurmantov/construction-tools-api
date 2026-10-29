/**
 * IndexNow ownership check: Yandex fetches `/<key>.txt` and expects the key
 * back before it trusts the backend's pings (backend `seo/indexnow.service.ts`).
 * Answered here rather than from `public/`, so the key stays a runtime
 * setting (`NUXT_INDEXNOW_KEY`) and is not committed.
 */
export default defineEventHandler((event) => {
  const key = String(useRuntimeConfig(event).indexnowKey || '').trim()
  if (!key || !/^[a-zA-Z0-9-]{8,128}$/.test(key)) return
  if (event.path !== `/${key}.txt`) return
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=3600')
  return key
})
