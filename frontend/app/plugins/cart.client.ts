import { useCartStore } from '~/stores/cart'
import { useWishlistStore } from '~/stores/wishlist'
import { useCompareStore } from '~/stores/compare'

/** Rehydrates the localStorage-backed guest stores on the client. */
export default defineNuxtPlugin(() => {
  useCartStore().load()
  useWishlistStore().load()
  useCompareStore().load()
})
