/**
 * Restores the account session on the client. The token lives in
 * localStorage, so there is nothing for the server to render — the header
 * waits for `ready` before deciding between "Войти" and the account menu.
 */
export default defineNuxtPlugin(() => {
  const { refresh } = useAuth()
  onNuxtReady(() => {
    void refresh()
  })
})
