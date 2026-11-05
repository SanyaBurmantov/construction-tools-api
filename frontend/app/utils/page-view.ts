import { readJson, writeJson } from '~/utils/safe-storage'

/**
 * The browser half of the site's own traffic statistics (backend `traffic/`,
 * `/admin/traffic` «Посещаемость»): one report per page shown.
 *
 * A **visit** starts after 30 minutes without a page — the same rule Metrika
 * uses — so `entry` is decided here from the time of the last page. The
 * visitor id is a random value kept in localStorage: it counts unique
 * visitors and identifies nobody. Storage that throws (private mode, blocked
 * site data) just makes every page an entry of an anonymous visitor.
 */
const KEY = 'traffic:v1'
const VISIT_GAP_MS = 30 * 60 * 1000

type Stored = { id?: string, lastAt?: number }

export type PageViewBody = {
  path: string
  status: 200 | 404
  entry: boolean
  visitorId?: string
  referrer?: string
  touch?: boolean
  utmSource?: string
  utmMedium?: string
  click?: 'yclid' | 'gclid'
}

function randomId(): string | undefined {
  try {
    return crypto.randomUUID()
  } catch {
    return undefined
  }
}

/** Whether this page starts a visit; pure, for tests. */
export function startsVisit(lastAt: number | undefined, now: number): boolean {
  return !lastAt || now - lastAt > VISIT_GAP_MS
}

/**
 * The report for the page now on screen. `previousPath` is our page the
 * visitor came from by a client-side move; on a fresh load the browser's own
 * referrer is used.
 */
export function pageViewBody(status: 200 | 404, previousPath?: string): PageViewBody {
  const now = Date.now()
  const stored = readJson<Stored>(KEY) ?? {}
  const entry = startsVisit(stored.lastAt, now)
  const id = stored.id ?? randomId()
  writeJson(KEY, { id, lastAt: now })

  const url = new URL(window.location.href)
  const body: PageViewBody = {
    path: url.pathname,
    status,
    entry,
    visitorId: id,
    touch: navigator.maxTouchPoints > 1,
  }
  const referrer = previousPath ? `${url.origin}${previousPath}` : document.referrer
  if (referrer) body.referrer = referrer.slice(0, 2000)
  if (entry) {
    const utmSource = url.searchParams.get('utm_source')?.trim()
    const utmMedium = url.searchParams.get('utm_medium')?.trim()
    if (utmSource) body.utmSource = utmSource.slice(0, 200)
    if (utmMedium) body.utmMedium = utmMedium.slice(0, 200)
    if (url.searchParams.has('yclid')) body.click = 'yclid'
    else if (url.searchParams.has('gclid')) body.click = 'gclid'
  }
  return body
}
