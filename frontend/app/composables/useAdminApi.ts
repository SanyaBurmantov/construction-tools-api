/**
 * Admin API client.
 *
 * Auth is an **ADMIN account session** (`Authorization: Bearer <token>`),
 * shared with the storefront through `useAuth` — one login for the whole site.
 * The backend still accepts `x-admin-token` for service-to-service calls
 * (runbook curl, CI), but the UI no longer asks a human for that secret.
 */
export function useAdminApi() {
  const config = useRuntimeConfig()
  const { token, user, isAdmin, readStoredToken, refresh, logout, errorMessage } = useAuth()
  const authorized = useState('admin-authorized', () => false)

  async function adminFetch<T>(path: string, options: Parameters<typeof $fetch>[1] = {}) {
    try {
      return await $fetch<T>(`${config.public.apiBase}/admin${path}`, {
        ...options,
        headers: {
          ...(options.headers || {}),
          ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}),
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
    // `token` is the account session token; admin pages only ever check that
    // there is one before firing a request. `loadToken` keeps its old name so
    // the pages that call it did not have to change.
    token,
    loadToken: readStoredToken,
    user,
    isAdmin,
    authorized,
    refresh,
    logout,
    adminFetch,
    errorMessage,
  }
}
