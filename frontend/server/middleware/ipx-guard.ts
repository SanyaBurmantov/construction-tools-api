import { createError, getRequestURL, setResponseHeader } from 'h3'

/**
 * `/_ipx` is a public image resizer, and its modifiers are user input: one
 * `GET /_ipx/enlarge&s_8192x8192&f_avif/<photo>` made sharp allocate ~2.5 GB
 * and the 384 MB frontend container was OOM-killed (audit 2026-10-30). Two
 * guards here, the size cap itself is `image.ipx.maxOutputDimension` in
 * nuxt.config:
 *
 * 1. **Only the modifiers the storefront generates.** `productThumb`,
 *    `productGallery`, the category cards and `utils/og-image.ts` produce
 *    `q_80&fit_inside&s_WxH` and `f_jpeg&q_85&fit_contain&b_ffffff&s_1200x630`.
 *    The grammar below admits those keys with bounded values and answers 400
 *    to anything else — `enlarge`, `extend`, `blur`, `rotate`, AVIF (seconds
 *    of CPU per image) — so a new component width needs no change here, but a
 *    hand-crafted URL cannot reach sharp's expensive paths.
 * 2. **At most `MAX_ACTIVE` resizes at once.** A cold page cache after a
 *    deploy fans out into dozens of thumbnails; each is a decode + resize in
 *    the heap. Extra requests wait in line, and past `MAX_WAITING` the answer
 *    is 503 + Retry-After instead of a container killed for everyone. A slot
 *    is released on the response's `close`, which fires for a finished *and*
 *    an aborted request, so a client that hangs up cannot leak one.
 */
const MAX_DIMENSION = 1200
const MAX_ACTIVE = 3
const MAX_WAITING = 40

type ModifierRule = (value: string) => boolean // eslint-disable-line no-unused-vars

const MODIFIER_RULES: Record<string, ModifierRule> = {
  q: v => /^\d{1,3}$/.test(v) && +v >= 1 && +v <= 100,
  fit: v => v === 'inside' || v === 'contain' || v === 'cover',
  s: (v) => {
    const m = /^(\d{1,4})x(\d{1,4})$/.exec(v)
    return !!m && dimensionOk(m[1]!) && dimensionOk(m[2]!)
  },
  w: v => /^\d{1,4}$/.test(v) && dimensionOk(v),
  h: v => /^\d{1,4}$/.test(v) && dimensionOk(v),
  f: v => v === 'jpeg' || v === 'jpg' || v === 'webp' || v === 'png',
  b: v => /^[0-9a-f]{3,8}$/i.test(v),
}

function dimensionOk(value: string): boolean {
  const n = Number(value)
  return n >= 1 && n <= MAX_DIMENSION
}

/** The `/_ipx/<modifiers>/<source>` modifiers segment is allowed. */
export function ipxModifiersAllowed(segment: string): boolean {
  if (segment === '_') return true
  const parts = segment.split(/[&,]/)
  if (parts.length > MODIFIER_RULES_COUNT) return false
  const seen = new Set<string>()
  for (const part of parts) {
    const at = part.indexOf('_')
    if (at <= 0) return false
    const key = part.slice(0, at)
    const rule = MODIFIER_RULES[key]
    if (!rule || seen.has(key) || !rule(part.slice(at + 1))) return false
    seen.add(key)
  }
  return true
}
const MODIFIER_RULES_COUNT = Object.keys(MODIFIER_RULES).length

let active = 0
const waiting: Array<() => void> = []

function release(): void {
  const next = waiting.shift()
  if (next) next()
  else active--
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/_ipx/')) return

  let segment = path.slice('/_ipx/'.length).split('/', 1)[0] ?? ''
  try {
    segment = decodeURIComponent(segment)
  } catch {
    segment = ''
  }
  if (!ipxModifiersAllowed(segment)) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported image modifiers' })
  }

  if (active >= MAX_ACTIVE) {
    if (waiting.length >= MAX_WAITING) {
      setResponseHeader(event, 'retry-after', 5)
      throw createError({ statusCode: 503, statusMessage: 'Image resizer busy' })
    }
    // `release()` hands its slot straight to the next waiter, so `active`
    // stays the same when a waiter starts.
    await new Promise<void>(resolve => waiting.push(resolve))
  } else {
    active++
  }
  event.node.res.once('close', release)
})
