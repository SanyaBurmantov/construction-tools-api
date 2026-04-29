export function useAdminApi() {
  const config = useRuntimeConfig()
  const token = useState('admin-token', () => '')

  function loadToken() {
    if (import.meta.client && !token.value) {
      token.value = localStorage.getItem('admin-token') || ''
    }
  }

  function saveToken() {
    if (import.meta.client) localStorage.setItem('admin-token', token.value)
  }

  async function adminFetch<T>(path: string, options: Parameters<typeof $fetch>[1] = {}) {
    return $fetch<T>(`${config.public.apiBase}/admin${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'x-admin-token': token.value
      }
    })
  }

  return { token, loadToken, saveToken, adminFetch }
}
