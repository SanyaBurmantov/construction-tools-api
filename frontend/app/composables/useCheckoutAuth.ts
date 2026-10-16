/**
 * Checkout needs an account; browsing and filling the cart do not.
 *
 * The cart itself lives in localStorage, so sending someone to the login
 * screen and back keeps every line they picked — the redirect target brings
 * them straight back to the checkout with the same cart.
 */
export const AUTH_REASONS: Record<string, string> = {
  checkout: 'Для оформления заказа необходима авторизация',
  account: 'Войдите, чтобы открыть личный кабинет',
}

export function useCheckoutAuth() {
  const { whenReady, isAuthenticated } = useAuth()

  /**
   * Resolves to true when there is an account behind the request. Otherwise it
   * navigates to the login screen with the reason and where to come back to,
   * and resolves to false.
   */
  async function ensureAuthenticated(redirect = '/checkout', reason = 'checkout') {
    // The session is restored by a client plugin on nuxt-ready; a click that
    // lands before that would otherwise look like "not signed in".
    await whenReady()
    if (isAuthenticated.value) return true

    await navigateTo({ path: '/login', query: { redirect, reason } })
    return false
  }

  return { ensureAuthenticated }
}

/**
 * The `?redirect=` / `?reason=` pair the login and registration screens share:
 * where to return after signing in, why the visitor was sent here, and the
 * link to the other screen that carries both over.
 */
export function useAuthRedirect(otherScreen: '/login' | '/register') {
  const route = useRoute()
  const { whenReady, isAuthenticated } = useAuth()

  /**
   * Same-site paths only. `//host` and `/\host` start with a slash too, and a
   * browser reads both as another site — an open redirect after login.
   */
  const redirect = computed(() => {
    const target = route.query.redirect
    return typeof target === 'string' && target.startsWith('/') && !/^\/[/\\]/.test(target)
      ? target
      : ''
  })

  /**
   * Why the visitor was sent here (`?reason=checkout` when they pressed
   * "Оформить заказ" with a full cart). The cart is untouched — it is in
   * localStorage and the redirect brings them back to it.
   */
  const reasonKey = computed(() =>
    typeof route.query.reason === 'string' ? route.query.reason : ''
  )
  const reason = computed(() => AUTH_REASONS[reasonKey.value] || '')

  const otherLink = computed(() => ({
    path: otherScreen,
    query: {
      ...(redirect.value ? { redirect: redirect.value } : {}),
      ...(reasonKey.value ? { reason: reasonKey.value } : {}),
    },
  }))

  /** Already signed in — no reason to show the form again. */
  async function leaveIfSignedIn() {
    await whenReady()
    if (isAuthenticated.value) await navigateTo(redirect.value || '/account')
  }

  return { redirect, reason, otherLink, leaveIfSignedIn }
}
