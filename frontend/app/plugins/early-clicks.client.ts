/**
 * Replays the clicks the inline `early-clicks` script (nuxt.config.ts) caught
 * before hydration — a «В корзину» pressed while the page was still server
 * HTML used to do nothing. Each caught button is found again by its
 * `data-early-click` key (the node itself may have been replaced) and
 * clicked once, now that its Vue handler is attached.
 */
type EarlyWindow = Window & { __gostEarly?: string[], __gostHydrated?: boolean }

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:suspense:resolve', () => {
    const w = window as EarlyWindow
    if (w.__gostHydrated) return
    w.__gostHydrated = true
    const keys = w.__gostEarly ?? []
    w.__gostEarly = []
    if (!keys.length) return
    // Next frame: every component of the page has mounted its listeners.
    requestAnimationFrame(() => {
      document.querySelectorAll('[data-early-pending]').forEach(el => el.removeAttribute('data-early-pending'))
      for (const key of keys) {
        document.querySelector<HTMLElement>(`[data-early-click="${CSS.escape(key)}"]`)?.click()
      }
    })
  })
})
