/**
 * Reports JavaScript errors visitors hit to `POST /client-errors`, shown in
 * /admin/errors as «Браузер». The API's own errors were always there; a
 * broken button in someone's Safari was invisible — the visitor just left.
 *
 * Kept small on purpose: production only, at most MAX_REPORTS per page load,
 * one report per distinct message, and the usual noise dropped before it
 * costs a request (browser extensions, cross-origin «Script error.»,
 * Metrika's own scripts, ResizeObserver warnings, aborted fetches).
 * The page path is sent without its query — it may carry a token.
 */
const MAX_REPORTS = 5

const NOISE = [
  /^Script error\.?$/i,
  /ResizeObserver loop/i,
  /AbortError|The user aborted a request|signal is aborted/i,
  /Load failed|Failed to fetch|NetworkError when attempting/i,
]
const NOISY_SOURCES = /(chrome|moz|safari(-web)?)-extension:|mc\.yandex\.|yandex\.ru\/metrika|webvisor/i

type Report = {
  message: string
  name?: string
  stack?: string
  source?: string
  line?: number
  column?: number
}

export default defineNuxtPlugin((nuxtApp) => {
  if (import.meta.dev) return
  const config = useRuntimeConfig()
  // Kill switch in /admin/features; on until the flags say otherwise.
  const enabled = useFeature('client-error-reports')
  const seen = new Set<string>()
  let sent = 0

  function send(report: Report) {
    const message = report.message.trim().slice(0, 1000)
    if (!enabled.value || !message || sent >= MAX_REPORTS || seen.has(message)) return
    if (NOISE.some(pattern => pattern.test(message))) return
    if (NOISY_SOURCES.test(`${report.source ?? ''} ${report.stack ?? ''}`)) return
    seen.add(message)
    sent += 1
    const body = JSON.stringify({
      ...report,
      message,
      stack: report.stack?.slice(0, 4000),
      path: window.location.pathname,
      release: config.app.buildId,
    })
    try {
      // keepalive: an error right before navigation still gets out.
      void fetch(`${config.public.apiBase}/client-errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'omit',
      }).catch(() => undefined)
    } catch {
      // Reporting must never become a second error.
    }
  }

  function fromError(error: unknown, fallbackName?: string): Report {
    if (error instanceof Error) {
      return { message: error.message || String(error), name: error.name || fallbackName, stack: error.stack }
    }
    return { message: typeof error === 'string' ? error : JSON.stringify(error) ?? String(error), name: fallbackName }
  }

  window.addEventListener('error', (event) => {
    // A failed <img>/<script> load is an Event without an error — not ours to report.
    if (!event.message && !event.error) return
    const report = event.error ? fromError(event.error) : { message: event.message }
    send({ ...report, source: event.filename, line: event.lineno, column: event.colno })
  })

  window.addEventListener('unhandledrejection', (event) => {
    send(fromError(event.reason, 'unhandledrejection'))
  })

  // Errors inside components (render, setup, watchers) that Vue caught.
  nuxtApp.hook('vue:error', (error) => {
    send(fromError(error, 'vue'))
  })
})
