/**
 * Reports searches and result clicks to the search journal
 * (`POST /search/events`, backend `search-log/`, report in `/admin/search`).
 * Client-only and fire-and-forget: a lost event costs nothing, and the
 * visitor never waits for it. Sent from the browser on purpose — crawlers
 * that run no script stay out, and a catalogue page served from the page
 * cache still counts.
 */
type Source = 'catalog' | 'suggest'

export function useSearchLog() {
  const { authFetch } = useAuth()

  function send(body: Record<string, unknown>) {
    if (import.meta.server) return
    void authFetch('/search/events', { method: 'POST', body }).catch(() => undefined)
  }

  return {
    /** A search that showed `results` products. */
    logSearch(term: string, results: number, source: Source) {
      if (term.trim().length < 2) return
      send({ kind: 'SEARCH', term, results, source })
    },
    /** A product picked from those results; `position` counts from 1. */
    logClick(term: string, productId: string, position: number, source: Source) {
      if (term.trim().length < 2) return
      send({ kind: 'CLICK', term, productId, position, source })
    },
  }
}
