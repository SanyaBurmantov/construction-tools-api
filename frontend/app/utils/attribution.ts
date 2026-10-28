import { readJson, writeJson } from '~/utils/safe-storage'

/**
 * Where this visitor came from, kept in localStorage and sent with an order
 * or a lead (`attribution`). The API turns it into a label («yandex / cpc»,
 * «google / organic», «direct») — this side only records what it saw.
 *
 * Two touches: the **first** visit ever (how they found us) and the **last**
 * visit that had a source (what brought them back to buy). A direct visit —
 * a bookmark, the address typed in — never overwrites a known source.
 * Nothing personal: UTM tags, an ad click id, the referrer's host, the
 * landing path.
 */
export type Touch = {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  yclid?: string
  gclid?: string
  referrer?: string
  landing?: string
  at?: string
}

type Stored = { first?: Touch, last?: Touch }

const KEY = 'attribution:v1'
/** A source older than this no longer explains today's order. */
const LAST_TOUCH_TTL_MS = 90 * 24 * 60 * 60 * 1000

const UTM: Array<[keyof Touch, string]> = [
  ['utmSource', 'utm_source'],
  ['utmMedium', 'utm_medium'],
  ['utmCampaign', 'utm_campaign'],
  ['utmContent', 'utm_content'],
  ['utmTerm', 'utm_term'],
  ['yclid', 'yclid'],
  ['gclid', 'gclid'],
]

const cut = (value: string, max: number) => value.slice(0, max)

/** Our own pages, with and without www, are not a referrer. */
function externalReferrerHost(referrer: string, ownHost: string): string | undefined {
  if (!referrer) return undefined
  try {
    const host = new URL(referrer).hostname.toLowerCase()
    const strip = (h: string) => h.replace(/^www\./, '')
    return strip(host) === strip(ownHost.toLowerCase()) ? undefined : host
  } catch {
    return undefined
  }
}

/** The touch of the page being opened now. Pure, for tests. */
export function touchFromLanding(url: URL, referrer: string, now = new Date()): Touch {
  const touch: Touch = { landing: cut(url.pathname, 300), at: now.toISOString() }
  for (const [field, param] of UTM) {
    const value = url.searchParams.get(param)?.trim()
    if (value) touch[field] = cut(value, field === 'utmSource' || field === 'utmMedium' ? 100 : 200)
  }
  const host = externalReferrerHost(referrer, url.hostname)
  if (host) touch.referrer = cut(host, 200)
  return touch
}

export function touchHasSource(touch?: Touch): boolean {
  return Boolean(touch && (touch.utmSource || touch.yclid || touch.gclid || touch.referrer))
}

/** Folds the current touch into what is stored. Pure, for tests. */
export function mergeTouches(stored: Stored, touch: Touch, now = Date.now()): Stored {
  const next: Stored = { ...stored }
  if (!next.first) next.first = touch
  if (touchHasSource(touch)) next.last = touch
  if (next.last?.at && now - Date.parse(next.last.at) > LAST_TOUCH_TTL_MS) delete next.last
  return next
}

/** Called once per page load by the plugin. */
export function recordVisit() {
  if (typeof window === 'undefined') return
  const touch = touchFromLanding(new URL(window.location.href), document.referrer)
  writeJson(KEY, mergeTouches(readJson<Stored>(KEY) ?? {}, touch))
}

/** What to send with an order or a lead; undefined when nothing is known. */
export function getAttribution(): Stored | undefined {
  if (typeof window === 'undefined') return undefined
  const stored = readJson<Stored>(KEY)
  return stored?.first || stored?.last ? stored : undefined
}
