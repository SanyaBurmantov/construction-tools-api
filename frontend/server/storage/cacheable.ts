/**
 * Which page-cache entries are worth storing, decided by both cache drivers.
 *
 * A driver sees Nitro's entry as JSON text, `{…"value":{"code":…,"headers":
 * {…},"body":"<html>…"}…}`. The status and headers come before the body, so
 * only the text up to `"body":` is looked at — parsing a megabyte of HTML to
 * read two fields would cost more than the write.
 *
 * Not stored:
 * - redirects (3xx): a product merged away or a renamed category is a tiny
 *   page that never needed rendering twice, and a crawler walking stale links
 *   filled the cache with them;
 * - responses marked `PAGE_CACHE_SKIP_HEADER` (search results, see
 *   server/plugins/page-cache-skip.ts).
 */
export const PAGE_CACHE_SKIP_HEADER = 'x-page-cache'

const HEAD_SCAN_LIMIT = 64 * 1024

export function isCacheableEntry(text: string): boolean {
  const bodyAt = text.indexOf('"body":')
  const head = text.slice(0, bodyAt >= 0 ? bodyAt : Math.min(text.length, HEAD_SCAN_LIMIT))
  if (/"code":3\d\d\b/.test(head)) return false
  if (head.includes(`"${PAGE_CACHE_SKIP_HEADER}":"skip"`)) return false
  return true
}
