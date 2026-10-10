import { useCartStore } from '~/stores/cart'

/** Pause before mirroring cart edits up, so a quantity stepper is one request. */
const PUSH_DEBOUNCE_MS = 800

/**
 * Keeps the account's stored cart in step with the local one.
 *
 * Two directions, deliberately asymmetric:
 * - **On sign-in**, the local cart is *merged* into the stored one and the
 *   result replaces the local lines. That is what makes "add things as a
 *   guest, then log in" keep everything, and what restores a cart on a new
 *   device. A product in both keeps the larger quantity — the server does the
 *   merge, so two tabs cannot double a line.
 * - **On every later change**, the local cart is pushed up as-is (last write
 *   wins). The cart is edited on one device at a time; a conflict resolution
 *   scheme would cost far more than it saves.
 *
 * Every call is best-effort: a failed sync leaves the local cart untouched and
 * the customer unaware, because the local cart is what checkout submits.
 */
export default defineNuxtPlugin(() => {
  const cart = useCartStore()
  const { isAuthenticated } = useAuth()
  const { mergeLocal, replace } = useServerCart()
  const toast = useAppToast()

  // While applying the server's answer, the local cart changes — without this
  // the watcher below would push that straight back up.
  let applying = false
  let merging = false
  let pushTimer: ReturnType<typeof setTimeout> | undefined

  const payload = () =>
    cart.items.map(item => ({ productId: item.productId, quantity: item.quantity }))

  async function mergeOnSignIn() {
    if (merging) return
    merging = true
    try {
      const server = await mergeLocal(payload())
      applying = true
      cart.applyServerCart(
        server.items.map(line => ({
          productId: line.productId,
          slug: line.slug,
          name: line.name,
          sku: line.sku,
          image: line.image,
          // A line with no price is kept at 0 and flagged by the cart screen's
          // own validation, same as any other stale line.
          price: line.price ?? 0,
          currency: line.currency,
          quantity: line.quantity,
        }))
      )
      if (server.dropped.length) {
        toast.warning(
          server.dropped.length === 1
            ? `Товар «${server.dropped[0]?.name || 'без названия'}» больше не доступен и убран из корзины`
            : `${server.dropped.length} товаров больше не доступны и убраны из корзины`
        )
      }
    } catch {
      // Offline, or the session expired — the local cart still works.
    } finally {
      // Applying the server cart changes the local one, which queues the
      // watcher below. Flags have to outlive that flush, or the merged cart
      // would be pushed straight back up as a "change".
      await nextTick()
      applying = false
      merging = false
    }
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      replace(payload()).catch(() => undefined)
    }, PUSH_DEBOUNCE_MS)
  }

  onNuxtReady(() => {
    cart.load()
    // The session is restored by plugins/auth.client.ts, which may finish
    // after this; the watcher below covers that case.
    if (isAuthenticated.value) void mergeOnSignIn()

    watch(isAuthenticated, (signedIn, wasSignedIn) => {
      if (signedIn && !wasSignedIn) void mergeOnSignIn()
    })

    // Keyed on ids and quantities only: a price refresh is not a cart change.
    watch(
      () => cart.items.map(item => `${item.productId}:${item.quantity}`).join(','),
      () => {
        if (!isAuthenticated.value || applying || merging) return
        schedulePush()
      }
    )
  })
})
