/**
 * One report per page shown, for the site's own statistics (`/admin/traffic`).
 *
 * The first page is reported once the app has mounted, every later one when
 * the client-side move has rendered (`page:finish`). A move that ended on the
 * error screen is not reported here: `error.vue` reports its 404 itself, with
 * the page the visitor came from — which is what the 404 journal is for.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const { report } = usePageViews()
  const router = useRouter()
  const error = useError()

  let navigation = 0
  let reported = -1
  let previousPath: string | undefined

  router.afterEach((to, from) => {
    // `from.matched` is empty on the initial navigation (hydration); a filter
    // change on the same page (query only) is not another page.
    if (!from.matched.length || to.path === from.path) return
    navigation++
    previousPath = from.path
  })

  function reportPage() {
    if (reported === navigation) return
    reported = navigation
    if (error.value) return
    void report(200, navigation ? previousPath : undefined)
  }

  nuxtApp.hook('app:mounted', reportPage)
  nuxtApp.hook('page:finish', reportPage)
})
