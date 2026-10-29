/**
 * Яндекс.Метрика не должна видеть админку (см. `nuxt.config.ts`). Сниппет на
 * `/admin*` не загружается, но счётчик, запущенный на витрине, засчитал бы
 * переход в админку по History API — поэтому такой переход делается полной
 * загрузкой страницы. Без счётчика (dev, блокировщик) роутер работает как
 * обычно.
 */
const isAdminPath = (path: string) => path === '/admin' || path.startsWith('/admin/')

export default defineNuxtPlugin(() => {
  useRouter().beforeEach((to, from) => {
    // `from.matched` is empty on the initial navigation (hydration).
    if (!from.matched.length || isAdminPath(from.path) || !isAdminPath(to.path)) return
    if (!('ym' in window)) return
    window.location.assign(to.fullPath)
    return false
  })
})
