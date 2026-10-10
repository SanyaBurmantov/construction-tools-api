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
  const { ready, refresh, isAuthenticated } = useAuth()

  /**
   * Resolves to true when there is an account behind the request. Otherwise it
   * navigates to the login screen with the reason and where to come back to,
   * and resolves to false.
   */
  async function ensureAuthenticated(redirect = '/checkout', reason = 'checkout') {
    // The session is restored by a client plugin on nuxt-ready; a click that
    // lands before that would otherwise look like "not signed in".
    if (!ready.value) await refresh()
    if (isAuthenticated.value) return true

    await navigateTo({ path: '/login', query: { redirect, reason } })
    return false
  }

  return { ensureAuthenticated }
}
