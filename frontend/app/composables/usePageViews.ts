import { pageViewBody } from '~/utils/page-view'

/**
 * Sends page views to `POST /traffic/views` (see `utils/page-view.ts`).
 * Client-only and fire-and-forget. Waits for the session check so an admin
 * browsing the storefront is never counted, and skips the admin panel itself.
 */
export function usePageViews() {
  const { authFetch, whenReady, canUseAdmin } = useAuth()

  async function report(status: 200 | 404, previousPath?: string) {
    if (import.meta.server) return
    if (window.location.pathname.startsWith('/admin')) return
    // Read the page now: by the time the session check answers, the visitor
    // may already be on the next one.
    const body = pageViewBody(status, previousPath)
    await whenReady().catch(() => undefined)
    if (canUseAdmin.value) return
    await authFetch('/traffic/views', { method: 'POST', body }).catch(() => undefined)
  }

  return { report }
}
