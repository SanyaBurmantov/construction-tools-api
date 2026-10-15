/**
 * Admin API client.
 *
 * Auth is an **ADMIN account session** — the HttpOnly session cookie shared
 * with the storefront through `useAuth`, one login for the whole site. Calls
 * are same-origin `/api`, so the browser attaches the cookie; the
 * `X-Requested-With` header is the CSRF proof the backend asks of a cookie
 * session. The backend still accepts `x-admin-token` and
 * `Authorization: Bearer` for service-to-service calls (runbook curl, CI), but
 * the UI never holds a token.
 */
export function useAdminApi() {
  const config = useRuntimeConfig()
  const { user, isAdmin, isAuthenticated, refresh, logout, errorMessage } = useAuth()
  const authorized = useState('admin-authorized', () => false)

  async function adminFetch<T>(path: string, options: Parameters<typeof $fetch>[1] = {}) {
    try {
      return await $fetch<T>(`${config.public.apiBase}/admin${path}`, {
        ...options,
        credentials: 'same-origin',
        headers: {
          ...API_REQUEST_HEADERS,
          ...(options.headers as Record<string, string> | undefined),
        },
      })
    } catch (error) {
      // 401 means the session is gone or expired — drop the authorized flag so
      // the login screen comes back instead of every request failing. A 403 is
      // a valid session without admin rights, which is a different screen.
      const status
        = (error as { statusCode?: number }).statusCode
          ?? (error as { status?: number }).status
      if (status === 401) authorized.value = false
      throw error
    }
  }

  return {
    // True once the layout gate has loaded the account. Pages that poll check
    // it before firing a request (they used to check for a stored token).
    hasSession: isAuthenticated,
    user,
    isAdmin,
    authorized,
    refresh,
    logout,
    adminFetch,
    errorMessage,
  }
}
