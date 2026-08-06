const STORAGE_KEY = 'admin-token'

/**
 * Admin session. There are no accounts — auth is the `ADMIN_TOKEN` shared
 * secret sent as `x-admin-token`, kept in localStorage between visits.
 */
export function useAdminApi() {
  const config = useRuntimeConfig()
  const token = useState('admin-token', () => '')
  const authorized = useState('admin-authorized', () => false)

  function loadToken() {
    if (import.meta.client && !token.value) {
      token.value = localStorage.getItem(STORAGE_KEY) || ''
    }
    return token.value
  }

  function saveToken() {
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, token.value)
    authorized.value = true
  }

  function logout() {
    token.value = ''
    authorized.value = false
    if (import.meta.client) localStorage.removeItem(STORAGE_KEY)
  }

  async function adminFetch<T>(path: string, options: Parameters<typeof $fetch>[1] = {}) {
    try {
      return await $fetch<T>(`${config.public.apiBase}/admin${path}`, {
        ...options,
        headers: {
          ...(options.headers || {}),
          'x-admin-token': token.value,
        },
      })
    } catch (error) {
      // A rejected token means the stored secret is stale — drop the authorized
      // flag so the login screen comes back instead of every request failing.
      const status
        = (error as { statusCode?: number }).statusCode
          ?? (error as { status?: number }).status
      if (status === 401) authorized.value = false
      throw error
    }
  }

  /** Unwraps the API's error envelope into a plain message. */
  function errorMessage(error: unknown, fallback = 'Что-то пошло не так') {
    const message = (error as { data?: { message?: string | string[] } }).data?.message
    if (Array.isArray(message)) return message.join(', ')
    return message || (error instanceof Error ? error.message : fallback)
  }

  return { token, authorized, loadToken, saveToken, logout, adminFetch, errorMessage }
}
