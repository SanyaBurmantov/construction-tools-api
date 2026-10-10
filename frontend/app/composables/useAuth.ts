export type CustomerType = 'INDIVIDUAL' | 'COMPANY'
export type UserRole = 'CUSTOMER' | 'ADMIN'

export type AccountUser = {
  id: string
  login: string
  role: UserRole
  customerType: CustomerType
  name: string | null
  email: string | null
  phone: string | null
  companyName: string | null
  taxId: string | null
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

export type RegisterPayload = {
  login: string
  password: string
  customerType: CustomerType
  name?: string
  email?: string
  phone?: string
  companyName?: string
  taxId?: string
}

type Session = { token: string, expiresAt: string, user: AccountUser }

const STORAGE_KEY = 'auth-token'

/**
 * Account session for the storefront and the admin panel.
 *
 * The session token is an opaque string issued by `POST /auth/login`; it lives
 * in localStorage next to the guest cart/wishlist and travels as
 * `Authorization: Bearer`. The server stores only its hash, so logging out
 * (or an admin disabling the account) kills it immediately.
 */
export function useAuth() {
  const config = useRuntimeConfig()
  const token = useState<string>('auth-token', () => '')
  const user = useState<AccountUser | null>('auth-user', () => null)
  // Distinguishes "not logged in" from "haven't checked yet", so the header
  // doesn't flash a login link at an admin on every page load.
  const ready = useState<boolean>('auth-ready', () => false)

  const isAuthenticated = computed(() => Boolean(user.value))
  const isAdmin = computed(() => user.value?.role === 'ADMIN')

  /**
   * Every localStorage access is guarded: `getItem` throws outright when site
   * data is blocked (private windows, embedded browsers, some corporate
   * policies), and an exception escaping here used to take the whole admin
   * gate down with it — the page sat on its loading skeleton forever, which
   * reads as "it just hangs". The session simply does not persist in that
   * case, which is the right degradation.
   */
  function readStoredToken() {
    if (import.meta.client && !token.value) {
      try {
        token.value = localStorage.getItem(STORAGE_KEY) || ''
      } catch {
        token.value = ''
      }
    }
    return token.value
  }

  function persist(session: Session) {
    token.value = session.token
    user.value = session.user
    if (import.meta.client) {
      try {
        localStorage.setItem(STORAGE_KEY, session.token)
      } catch {
        // Blocked or full storage: the session lives for this tab only.
      }
    }
  }

  function clear() {
    token.value = ''
    user.value = null
    if (import.meta.client) {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // Nothing to clean up if storage was never writable.
      }
    }
  }

  /** $fetch against the API with the session header attached when we have one. */
  async function authFetch<T>(path: string, options: Parameters<typeof $fetch>[1] = {}) {
    const headers: Record<string, string> = { ...(options.headers as Record<string, string>) }
    if (token.value) headers.Authorization = `Bearer ${token.value}`
    try {
      return await $fetch<T>(`${config.public.apiBase}${path}`, { ...options, headers })
    } catch (error) {
      // 401 means the stored token is gone or expired server-side — forget it
      // instead of retrying every request with a dead session.
      const status
        = (error as { statusCode?: number }).statusCode ?? (error as { status?: number }).status
      if (status === 401) clear()
      throw error
    }
  }

  async function login(credentials: { login: string, password: string }) {
    const session = await authFetch<Session>('/auth/login', {
      method: 'POST',
      body: credentials,
    })
    persist(session)
    ready.value = true
    return session.user
  }

  async function register(payload: RegisterPayload) {
    const session = await authFetch<Session>('/auth/register', {
      method: 'POST',
      body: payload,
    })
    persist(session)
    ready.value = true
    return session.user
  }

  async function logout() {
    try {
      if (token.value) await authFetch('/auth/logout', { method: 'POST' })
    } catch {
      // Already invalid server-side — dropping it locally is the same result.
    }
    clear()
    ready.value = true
  }

  /** Loads the account behind a stored token. Safe to call repeatedly. */
  async function refresh() {
    if (!readStoredToken()) {
      user.value = null
      ready.value = true
      return null
    }
    try {
      user.value = await authFetch<AccountUser>('/auth/me')
    } catch {
      clear()
    } finally {
      ready.value = true
    }
    return user.value
  }

  async function updateProfile(patch: Partial<RegisterPayload>) {
    user.value = await authFetch<AccountUser>('/auth/me', { method: 'PATCH', body: patch })
    return user.value
  }

  async function changePassword(body: { currentPassword: string, newPassword: string }) {
    await authFetch('/auth/password', { method: 'POST', body })
  }

  /**
   * Closes the account for good. Orders stay in the shop's records with the
   * link removed, so this deletes the account, not its history.
   */
  async function deleteAccount(password: string) {
    await authFetch('/auth/me', { method: 'DELETE', body: { password } })
    clear()
    ready.value = true
  }

  /** Drops every session of the account — this device included. */
  async function logoutEverywhere() {
    await authFetch('/auth/logout-all', { method: 'POST' })
    clear()
    ready.value = true
  }

  /** Unwraps the API's error envelope into a plain message. */
  function errorMessage(error: unknown, fallback = 'Что-то пошло не так') {
    const message = (error as { data?: { message?: string | string[] } }).data?.message
    if (Array.isArray(message)) return message.join(', ')
    return message || (error instanceof Error ? error.message : fallback)
  }

  return {
    token,
    user,
    ready,
    isAuthenticated,
    isAdmin,
    readStoredToken,
    authFetch,
    login,
    register,
    logout,
    refresh,
    updateProfile,
    changePassword,
    logoutEverywhere,
    deleteAccount,
    errorMessage,
  }
}
