/** Pause before mirroring edits up, so a quantity stepper or a burst of toggles is one request. */
const PUSH_DEBOUNCE_MS = 800

/**
 * The server merge is max-quantity / set union and idempotent, so repeating it
 * is safe; the bound only stops a customer clicking non-stop from keeping the
 * sign-in merge going forever.
 */
const MAX_MERGE_ROUNDS = 3

/**
 * Keeps an account's server-side copy of a localStorage list in step with the
 * local one — the cart (`plugins/cart-sync.client.ts`) and the favourites /
 * comparison (`plugins/lists-sync.client.ts`) share this machine.
 *
 * Two directions, deliberately asymmetric:
 * - **On sign-in**, the local state is *merged* into the stored one and the
 *   result replaces the local state. That is what makes "pick things as a
 *   guest, then log in" keep everything, and what restores it on a new device.
 * - **On every later change**, the local state is pushed up as-is (last write
 *   wins). It is edited on one device at a time; a conflict resolution scheme
 *   would cost far more than it saves.
 *
 * Every call is best-effort: a failed sync leaves the local state untouched,
 * because the local copy is what the UI renders and checkout submits.
 *
 * Must be called synchronously from a plugin's setup: it reads the session
 * through `useAuth()`, and `onNuxtReady` callbacks run outside the app context.
 */
export function mirrorToAccount<P, R>(options: {
  /** Restores the local state from storage before anything is compared. */
  load: () => void
  /** What counts as a change (ids and quantities — a price refresh is not one). */
  key: () => string
  payload: () => P
  merge: (payload: P) => Promise<R>
  replace: (payload: P) => Promise<unknown>
  /** Writes the server's merged answer into the local state. */
  apply: (result: R) => void
}) {
  const { isAuthenticated } = useAuth()

  // While applying the server's answer the local state changes — without this
  // the watcher below would push that straight back up.
  let applying = false
  let merging = false
  let pushTimer: ReturnType<typeof setTimeout> | undefined

  async function mergeOnSignIn() {
    if (merging) return
    merging = true
    try {
      let sent = options.key()
      let result = await options.merge(options.payload())
      // An edit made while the merge was in flight is not in its answer, and
      // applying the answer would silently drop it — so merge again with what
      // the customer has now.
      for (let round = 1; round < MAX_MERGE_ROUNDS && options.key() !== sent; round += 1) {
        sent = options.key()
        result = await options.merge(options.payload())
      }
      applying = true
      options.apply(result)
    } catch {
      // Offline, or the session expired — the local state still works.
    } finally {
      // Applying changes the local state, which queues the watcher below. The
      // flags have to outlive that flush, or the merged state would be pushed
      // straight back up as a "change".
      await nextTick()
      applying = false
      merging = false
    }
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      options.replace(options.payload()).catch(() => undefined)
    }, PUSH_DEBOUNCE_MS)
  }

  onNuxtReady(() => {
    // Guests get their local state back too — this is the only loader.
    options.load()
    // The session is restored by plugins/auth.client.ts, which may finish
    // after this; the watcher below covers that case.
    if (isAuthenticated.value) void mergeOnSignIn()

    watch(isAuthenticated, (signedIn, wasSignedIn) => {
      if (signedIn && !wasSignedIn) void mergeOnSignIn()
    })

    watch(options.key, () => {
      if (!isAuthenticated.value || applying || merging) return
      schedulePush()
    })
  })
}
