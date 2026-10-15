/**
 * Restores the account session on the client. The session is an HttpOnly
 * cookie scoped to `/api` — page requests never carry it, so there is nothing
 * for the server to render and the header waits for `ready` before deciding
 * between "Войти" and the account menu. `refresh()` also deletes any Bearer
 * token a previous version left in localStorage.
 */
export default defineNuxtPlugin(() => {
  const { refresh } = useAuth()
  onNuxtReady(() => {
    void refresh()
  })
})
