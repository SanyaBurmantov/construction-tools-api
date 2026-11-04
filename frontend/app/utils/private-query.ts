/**
 * Secrets that arrive in a URL — the e-mail confirmation token, the order
 * UUID of `/checkout/success` — must not stay in the address bar: Yandex
 * Metrika (webvisor on) records `location.href` on every hit, and the next
 * page's hit carries it again as the referrer (external audit 2026-11-03, E02).
 *
 * A page reads the value once, keeps it in sessionStorage (so a reload of the
 * same tab still works) and replaces the URL with the bare path. Pages that
 * navigate to such a screen hand the value over with `stashPrivateParam`
 * instead of putting it into the query at all. The Metrika snippet in
 * `nuxt.config.ts` blanks these parameters in its first hit as well, for a
 * link opened straight from a letter.
 */
const key = (path: string, name: string) => `private-query:${path}:${name}`

export const PRIVATE_QUERY_PARAMS = ['token', 'id'] as const

export function stashPrivateParam(path: string, name: string, value: string) {
  writeJson(key(path, name), value, 'session')
}

/** The value from the query (then removed from the address bar) or from this tab's stash. */
export function takePrivateParam(name: string): string {
  const route = useRoute()
  const fromQuery = route.query[name]
  if (typeof fromQuery === 'string' && fromQuery) {
    stashPrivateParam(route.path, name, fromQuery)
    if (import.meta.client) {
      const url = new URL(window.location.href)
      url.searchParams.delete(name)
      // Not router.replace: no navigation, no re-render, no Metrika SPA hit with the old URL.
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    }
    return fromQuery
  }
  return readJson<string>(key(route.path, name), 'session') ?? ''
}
