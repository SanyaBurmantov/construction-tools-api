export type CustomerType = 'INDIVIDUAL' | 'COMPANY'
export type UserRole = 'CUSTOMER' | 'ADMIN'

export type AccountUser = {
  id: string
  login: string
  role: UserRole
  customerType: CustomerType
  name: string | null
  email: string | null
  /** When the e-mail was confirmed by the link in the letter; null = not yet. */
  emailVerifiedAt: string | null
  phone: string | null
  companyName: string | null
  /** УНП. */
  taxId: string | null
  legalAddress: string | null
  /** Settlement account, a BY IBAN. */
  bankAccount: string | null
  bankName: string | null
  bankBic: string | null
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
  legalAddress?: string
  bankAccount?: string
  bankName?: string
  bankBic?: string
}

/** What login/register answer a browser with: the token itself stays in the cookie. */
type Session = { expiresAt: string, user: AccountUser }

/**
 * Sent with every API call. A cross-site form cannot set a custom header, so
 * the backend accepts it as proof that a cookie-authenticated mutating request
 * came from our own page (its CSRF check also accepts a matching Origin).
 */
export const API_REQUEST_HEADERS: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' }

/** Where the token used to live. Removed on sight — see `forgetLegacyToken`. */
const LEGACY_TOKEN_KEY = 'auth-token'
/**
 * A non-secret "there may be a session" marker. The cookie is HttpOnly, so
 * script cannot see whether it exists; without this every guest page view
 * would fire a `GET /auth/me` just to get a 401 back.
 */
const SESSION_HINT_KEY = 'auth-session'

/** The `GET /auth/me` in flight, shared by concurrent `refresh()` calls. */
let refreshing: Promise<AccountUser | null> | null = null

/** Status of an ofetch error, whichever of the two fields it set. */
function httpStatus(error: unknown) {
  return (error as { statusCode?: number }).statusCode ?? (error as { status?: number }).status
}

/**
 * Account session for the storefront and the admin panel.
 *
 * The session lives in an **HttpOnly cookie** set by `POST /auth/login` /
 * `register` (path `/api`, so it only ever travels with API calls — never with
 * a page request that SSR could render into shared, cached HTML). Page script
 * never holds the token, so an XSS cannot walk away with it. Whether someone
 * is signed in is learned from `GET /auth/me`; the server stores only the
 * token's hash, so logging out (or an admin disabling the account) kills it
 * immediately.
 */
export function useAuth() {
  const config = useRuntimeConfig()
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
   * gate down with it — the page sat on its loading skeleton forever.
   */
  function setHint(present: boolean) {
    if (!import.meta.client) return
    try {
      if (present) localStorage.setItem(SESSION_HINT_KEY, '1')
      else localStorage.removeItem(SESSION_HINT_KEY)
    } catch {
      // Unwritable storage: refresh() then simply always asks the server.
    }
  }

  /** True when a session may exist; unknown (blocked storage) counts as yes. */
  function mayHaveSession() {
    if (!import.meta.client) return false
    try {
      return localStorage.getItem(SESSION_HINT_KEY) === '1'
    } catch {
      return true
    }
  }

  /**
   * Bearer tokens from before the cookie switch: dropped, never sent. Those
   * sessions are simply signed in again once.
   */
  function forgetLegacyToken() {
    if (!import.meta.client) return
    try {
      localStorage.removeItem(LEGACY_TOKEN_KEY)
    } catch {
      // Nothing to clean up if storage was never readable.
    }
  }

  function persist(session: Session) {
    user.value = session.user
    setHint(true)
  }

  function clear() {
    user.value = null
    setHint(false)
  }

  /**
   * $fetch against the API. Same-origin `/api`, so the browser attaches the
   * session cookie by itself; the custom header is the CSRF proof.
   */
  async function authFetch<T>(path: string, options: Parameters<typeof $fetch>[1] = {}) {
    const headers: Record<string, string> = {
      ...API_REQUEST_HEADERS,
      ...(options.headers as Record<string, string>),
    }
    try {
      return await $fetch<T>(`${config.public.apiBase}${path}`, {
        ...options,
        headers,
        credentials: 'same-origin',
      })
    } catch (error) {
      // 401 means the session is gone or expired server-side (the API drops
      // the cookie with it) — forget it instead of retrying a dead session.
      if (httpStatus(error) === 401) clear()
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
      // Always asked, even with no user loaded: only the server can clear an
      // HttpOnly cookie.
      await authFetch('/auth/logout', { method: 'POST' })
    } catch {
      // Already invalid server-side — dropping it locally is the same result.
    }
    clear()
    ready.value = true
  }

  async function loadSession() {
    forgetLegacyToken()
    if (!mayHaveSession()) {
      user.value = null
      ready.value = true
      return null
    }
    try {
      user.value = await authFetch<AccountUser>('/auth/me')
      setHint(true)
    } catch {
      clear()
    } finally {
      ready.value = true
    }
    return user.value
  }

  /**
   * Loads the account behind the session cookie. Safe to call repeatedly:
   * concurrent callers (the plugin, a page, a checkout click) share one
   * `GET /auth/me`. Client-only sharing — on the server a module-level promise
   * would leak one request's state into another's.
   */
  function refresh(): Promise<AccountUser | null> {
    if (!import.meta.client) return loadSession()
    refreshing ??= loadSession().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  /** The session as soon as it is known — asks the server only if nobody has yet. */
  async function whenReady() {
    return ready.value ? user.value : refresh()
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

  /** Follows the link from the confirmation letter; works without a session. */
  async function verifyEmail(token: string) {
    const result = await authFetch<{ ok: boolean, email: string }>('/auth/verify-email', {
      method: 'POST',
      body: { token },
    })
    if (user.value?.email === result.email)
      user.value = { ...user.value, emailVerifiedAt: new Date().toISOString() }
    return result
  }

  /** «Отправить письмо ещё раз». */
  async function resendVerification() {
    return authFetch<{ ok: boolean, alreadyVerified: boolean }>('/auth/verify-email/resend', {
      method: 'POST',
    })
  }

  /** Drops every session of the account — this device included. */
  async function logoutEverywhere() {
    await authFetch('/auth/logout-all', { method: 'POST' })
    clear()
    ready.value = true
  }

  /**
   * Unwraps the API's error envelope into a plain message. An HTTP error
   * without one gets the fallback: ofetch's own message ("[POST] /api/orders:
   * 500 …") is not something to show a customer.
   */
  function errorMessage(error: unknown, fallback = 'Что-то пошло не так') {
    const message = (error as { data?: { message?: string | string[] } }).data?.message
    if (Array.isArray(message)) return message.join(', ')
    if (message) return message
    return error instanceof Error && httpStatus(error) == null ? error.message : fallback
  }

  return {
    user,
    ready,
    isAuthenticated,
    isAdmin,
    authFetch,
    login,
    register,
    logout,
    refresh,
    whenReady,
    updateProfile,
    changePassword,
    logoutEverywhere,
    deleteAccount,
    verifyEmail,
    resendVerification,
    errorMessage,
  }
}
