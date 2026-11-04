import type { ServerResponse } from 'node:http'
import { createError, getRequestURL, setResponseHeader } from 'h3'
import { ResizeGate } from '../utils/resize-gate'

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
 * 3. **A source that does not answer is skipped, not waited for.** IPX
 *    fetches the original with no timeout of its own; when th-tool.by stopped
 *    answering the server (2026-11-01) every one of its photos held a slot
 *    for the ~10 s TCP connect timeout, three of them filled the gate, and
 *    *every* photo — tools.by's too — got 503 until the queue drained
 *    (02.11). A slot is now held at most `SLOT_HOLD_MS`, and a source host
 *    whose fetch failed slowly is answered 502 at once for `HOST_DOWN_MS`:
 *    the browser falls back to the supplier's own URL (useResilientImage),
 *    which the visitor can usually reach even when we cannot. The slow
 *    request is *parked* (`ResizeGate`), not forgotten: when its fetch does
 *    return, sharp still resizes it, so at most `MAX_PARKED` may be parked
 *    and work in flight never exceeds MAX_ACTIVE + MAX_PARKED (audit
 *    2026-11-03: the old timer just released the slot, without bound). A
 *    request whose client hangs up while in line leaves the line.
 *
 * Errors are sent `no-store`: the `/_ipx/**` route rule gives every answer a
 * week of `max-age`, and a cached 503 would keep a photo broken for a week.
 */
const MAX_DIMENSION = 1200
const MAX_ACTIVE = 3
const MAX_WAITING = 40
const MAX_PARKED = 3
const SLOT_HOLD_MS = 8_000
const SLOW_FAILURE_MS = 5_000
const HOST_DOWN_MS = 10 * 60_000

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

/** Source host of `/_ipx/<modifiers>/<source>`, or '' for a local file. */
export function ipxSourceHost(path: string): string {
  const rest = path.slice('/_ipx/'.length)
  const source = rest.slice(rest.indexOf('/') + 1)
  return /^https?:\/\/?([^/?#]+)/i.exec(source)?.[1]?.toLowerCase() ?? ''
}

const gate = new ResizeGate(MAX_ACTIVE, MAX_WAITING, MAX_PARKED)
/** host → time until which its photos are not fetched. */
const downHosts = new Map<string, number>()

function hostIsDown(host: string): boolean {
  const until = downHosts.get(host)
  if (until === undefined) return false
  if (until > Date.now()) return true
  downHosts.delete(host)
  return false
}

/** An error answer must not inherit the route rule's week of caching. */
function noStoreOnError(res: ServerResponse): void {
  const mark = () => {
    if (res.statusCode >= 400 && !res.headersSent) res.setHeader('cache-control', 'no-store')
  }
  const writeHead = res.writeHead
  res.writeHead = function (this: ServerResponse, ...args: Parameters<ServerResponse['writeHead']>) {
    res.statusCode = args[0]
    mark()
    return writeHead.apply(this, args)
  } as ServerResponse['writeHead']
  const end = res.end
  res.end = function (this: ServerResponse, ...args: Parameters<ServerResponse['end']>) {
    mark()
    return end.apply(this, args)
  } as ServerResponse['end']
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/_ipx/')) return

  const res = event.node.res
  noStoreOnError(res)

  let segment = path.slice('/_ipx/'.length).split('/', 1)[0] ?? ''
  try {
    segment = decodeURIComponent(segment)
  } catch {
    segment = ''
  }
  if (!ipxModifiersAllowed(segment)) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported image modifiers' })
  }

  const host = ipxSourceHost(path)
  if (host && hostIsDown(host)) {
    throw createError({ statusCode: 502, statusMessage: 'Image source unavailable' })
  }

  const ticket = gate.enter()
  if (!ticket) {
    setResponseHeader(event, 'retry-after', 5)
    throw createError({ statusCode: 503, statusMessage: 'Image resizer busy' })
  }
  // Whatever happens next, the response closing — finished or abandoned —
  // gives back what this request holds (a place in line or a slot).
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined = undefined
  const markDown = () => {
    if (host) downHosts.set(host, Date.now() + HOST_DOWN_MS)
  }
  res.once('close', () => {
    clearTimeout(timer)
    if (res.statusCode >= 500 && Date.now() - startedAt >= SLOW_FAILURE_MS) markDown()
    ticket.cancel()
  })
  try {
    await ticket.ready
  } catch {
    // The client left while in line: nothing to resize for anyone.
    return
  }

  // The host may have been marked down while this request was in line.
  if (host && hostIsDown(host)) {
    ticket.done()
    throw createError({ statusCode: 502, statusMessage: 'Image source unavailable' })
  }

  // A fetch still hanging after this long is a source that is not answering:
  // park it (its slot goes to the next photo, within MAX_PARKED) and stop
  // sending this host's photos here.
  timer = setTimeout(() => {
    markDown()
    ticket.park()
  }, SLOT_HOLD_MS)
})
