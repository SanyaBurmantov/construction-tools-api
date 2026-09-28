import { defineStore } from 'pinia'

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
 * Guest favourites. Client-side only, persisted to localStorage — same
 * approach as the cart, since the storefront has no accounts.
 */
export const useWishlistStore = defineStore('wishlist', {
  state: () => ({
    items: [] as WishlistItem[],
    loaded: false,
  }),
  getters: {
    count: (state) => state.items.length,
    isEmpty: (state) => state.items.length === 0,
    ids: (state) => new Set(state.items.map((i) => i.productId)),
    has: (state) => (productId: string) =>
      state.items.some((i) => i.productId === productId),
  },
  actions: {
    load() {
      if (this.loaded || !import.meta.client) return
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        if (Array.isArray(parsed)) this.items = parsed
      } catch {
        this.items = []
      }
      this.loaded = true
    },
    persist() {
      if (!import.meta.client) return
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items))
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
  },
})
