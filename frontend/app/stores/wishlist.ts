import { defineStore } from 'pinia'
import { readArray, writeJson } from '~/utils/safe-storage'

export interface WishlistItem {
  productId: string
  slug: string
  name: string
  image: string | null
  price: number | null
  oldPrice: number | null
  currency: string
  addedAt: number
}

const STORAGE_KEY = 'wishlist:v1'
const MAX_ITEMS = 200

/**
 * Favourites. localStorage is the source of truth the UI renders (and all a
 * guest has); for a signed-in account `plugins/lists-sync.client.ts` keeps a
 * server-side copy in step, so the list survives a new device.
 */
export const useWishlistStore = defineStore('wishlist', {
  state: () => ({
    items: [] as WishlistItem[],
    loaded: false,
  }),
  getters: {
    count: (state) => state.items.length,
    isEmpty: (state) => state.items.length === 0,
    has: (state) => (productId: string) =>
      state.items.some((i) => i.productId === productId),
  },
  actions: {
    load() {
      if (this.loaded || !import.meta.client) return
      this.items = readArray<WishlistItem>(STORAGE_KEY)
      this.loaded = true
    },
    persist() {
      writeJson(STORAGE_KEY, this.items)
    },
    add(item: Omit<WishlistItem, 'addedAt'>) {
      if (this.has(item.productId)) return
      // Newest first, and drop the oldest once the cap is reached.
      this.items = [{ ...item, addedAt: Date.now() }, ...this.items].slice(0, MAX_ITEMS)
      this.persist()
    },
    remove(productId: string) {
      this.items = this.items.filter((i) => i.productId !== productId)
      this.persist()
    },
    /** Returns the state after toggling, so callers can word their toast. */
    toggle(item: Omit<WishlistItem, 'addedAt'>) {
      const added = !this.has(item.productId)
      if (added) this.add(item)
      else this.remove(item.productId)
      return added
    },
    clear() {
      this.items = []
      this.persist()
    },
    /**
     * Replaces every line with the account's list as the server serves it
     * (fresh prices, unavailable products already dropped). Used once per
     * sign-in, after the local list has been merged into it.
     */
    applyServerList(items: Array<Omit<WishlistItem, 'addedAt'>>) {
      this.items = items
        .slice(0, MAX_ITEMS)
        .map((item) => ({ ...item, addedAt: Date.now() }))
      this.loaded = true
      this.persist()
    },
  },
})
