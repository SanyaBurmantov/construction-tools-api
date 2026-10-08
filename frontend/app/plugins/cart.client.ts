import { useCartStore } from '~/stores/cart'
import { useWishlistStore } from '~/stores/wishlist'
import { useCompareStore } from '~/stores/compare'

/** Rehydrates the localStorage-backed guest stores on the client. */
export default defineNuxtPlugin(() => {
  // Match the server's empty state during hydration, then restore saved items.
  const cart = useCartStore()
  const wishlist = useWishlistStore()
  const compare = useCompareStore()
  onNuxtReady(() => {
    cart.load()
    wishlist.load()
    compare.load()
  })
})
