/**
 * Яндекс.Метрика и Google Tag Manager не должны видеть админку (см.
 * `nuxt.config.ts`). Сниппеты на `/admin*` не загружаются, но счётчик,
 * запущенный на витрине, засчитал бы переход в админку по History API —
 * поэтому такой переход делается полной загрузкой страницы. Без счётчиков
 * (dev, блокировщик, нет согласия) роутер работает как обычно.
 */
const isAdminPath = (path: string) => path === '/admin' || path.startsWith('/admin/')

export default defineNuxtPlugin(() => {
  useRouter().beforeEach((to, from) => {
    // `from.matched` is empty on the initial navigation (hydration).
    if (!from.matched.length || isAdminPath(from.path) || !isAdminPath(to.path)) return
    if (!('ym' in window) && !(window as { __gostGtmLoaded?: number }).__gostGtmLoaded) return
    window.location.assign(to.fullPath)
    return false
  })
})
