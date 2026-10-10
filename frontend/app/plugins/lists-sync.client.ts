import { useWishlistStore } from '~/stores/wishlist'
import { useCompareStore } from '~/stores/compare'

/** Same pause as the cart: a burst of toggles becomes one request. */
const PUSH_DEBOUNCE_MS = 800

/**
 * Keeps the account's favourites and comparison in step with the local ones.
 *
 * Deliberately identical to `cart-sync.client.ts` — merge on sign-in (so
 * picking things as a guest and then logging in keeps everything), replace on
 * every later change, best-effort throughout. The only difference is that
 * lists are sets, so there is nothing to reconcile beyond membership.
 */
export default defineNuxtPlugin(() => {
  const wishlist = useWishlistStore()
  const compare = useCompareStore()
  const { isAuthenticated } = useAuth()
  const { mergeLocal, replace } = useUserLists()

  let applying = false
  let merging = false
  let pushTimer: ReturnType<typeof setTimeout> | undefined

  const payload = () => ({
    wishlist: wishlist.items.map(item => item.productId),
    compare: compare.items.map(item => item.productId),
  })

  async function mergeOnSignIn() {
    if (merging) return
    merging = true
    try {
      const lists = await mergeLocal(payload())
      applying = true
      wishlist.applyServerList(
        lists.wishlist.map(line => ({
          productId: line.productId,
          slug: line.slug,
          name: line.name,
          image: line.image,
          price: line.price,
          oldPrice: line.oldPrice,
          currency: line.currency,
        }))
      )
      compare.applyServerList(
        lists.compare.map(line => ({
          productId: line.productId,
          slug: line.slug,
          name: line.name,
          image: line.image,
          price: line.price,
          oldPrice: line.oldPrice,
          currency: line.currency,
          categorySlug: line.categorySlug,
          categoryName: line.categoryName,
        }))
      )
    } catch {
      // Offline or an expired session — the local lists still work.
    } finally {
      // The flags have to outlive the watcher flush that applying triggers,
      // or the merged lists would be pushed straight back up as a change.
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
    wishlist.load()
    compare.load()
    if (isAuthenticated.value) void mergeOnSignIn()

    watch(isAuthenticated, (signedIn, wasSignedIn) => {
      if (signedIn && !wasSignedIn) void mergeOnSignIn()
    })

    // Membership only: a price refresh is not a change to the list.
    watch(
      () => [
        wishlist.items.map(item => item.productId).join(','),
        compare.items.map(item => item.productId).join(','),
      ].join('|'),
      () => {
        if (!isAuthenticated.value || applying || merging) return
        schedulePush()
      }
    )
  })
})
