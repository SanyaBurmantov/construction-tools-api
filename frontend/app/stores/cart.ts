import { defineStore } from 'pinia'
import { onStorageChange, readArray, readStoredArray, writeJson } from '~/utils/safe-storage'

export interface CartItem {
  productId: string
  slug: string
  name: string
  sku?: string | null
  image: string | null
  price: number
  currency: string
  quantity: number
  /**
   * The recommendation block the line came from (`UpsellSource`), sent with
   * the order for the admin's upsell report; '' = added on its own. The
   * first one sticks.
   */
  upsellSource?: string
}

const STORAGE_KEY = 'cart:v1'
/**
 * Same limits as the backend's `cart/cart-limits.ts` — sized for a company's
 * purchase request, not a household basket.
 */
export const MAX_QTY = 9999

export const useCartStore = defineStore('cart', {
  state: () => ({
    items: [] as CartItem[],
    loaded: false,
  }),
  getters: {
    count: (state) => state.items.reduce((sum, item) => sum + item.quantity, 0),
    distinctCount: (state) => state.items.length,
    totalPrice: (state) =>
      Math.round(
        state.items.reduce((sum, item) => sum + item.price * item.quantity, 0) *
          100,
      ) / 100,
    currency: (state) => state.items[0]?.currency || 'BYN',
    isEmpty: (state) => state.items.length === 0,
  },
  actions: {
    load() {
      if (this.loaded || !import.meta.client) return
      this.items = readArray<CartItem>(STORAGE_KEY)
      this.loaded = true
      // Another tab's edit lands here. Without it every tab wrote back the
      // copy it read when it opened: five products added from five tabs left
      // one in the cart (and the account's copy was then overwritten too).
      onStorageChange(STORAGE_KEY, () => this.refresh())
    },
    /** Re-reads storage before an edit — another tab may have changed it. */
    refresh() {
      if (!import.meta.client || !this.loaded) return
      const stored = readStoredArray<CartItem>(STORAGE_KEY)
      if (stored) this.items = stored
    },
    persist() {
      writeJson(STORAGE_KEY, this.items)
    },
    add(item: Omit<CartItem, 'quantity'>, quantity = 1) {
      this.refresh()
      const existing = this.items.find((i) => i.productId === item.productId)
      if (existing) {
        existing.quantity = Math.min(existing.quantity + quantity, MAX_QTY)
        existing.upsellSource ??= item.upsellSource
      } else {
        this.items.push({ ...item, quantity: Math.min(quantity, MAX_QTY) })
      }
      this.persist()
    },
    setQuantity(productId: string, quantity: number) {
      this.refresh()
      const item = this.items.find((i) => i.productId === productId)
      if (!item) return
      const next = Math.max(1, Math.min(Math.floor(quantity) || 1, MAX_QTY))
      item.quantity = next
      this.persist()
    },
    remove(productId: string) {
      this.refresh()
      this.items = this.items.filter((i) => i.productId !== productId)
      this.persist()
    },
    /**
     * Overwrites stored prices with the ones the server just confirmed.
     * Cart lines are snapshots taken when the item was added, and supplier
     * prices are re-parsed daily, so they drift.
     */
    applyPrices(prices: Array<{ productId: string, price: number, currency?: string }>) {
      this.refresh()
      const byId = new Map(prices.map((p) => [p.productId, p]))
      for (const item of this.items) {
        const update = byId.get(item.productId)
        if (!update) continue
        item.price = update.price
        if (update.currency) item.currency = update.currency
      }
      this.persist()
    },
    removeMany(productIds: string[]) {
      this.refresh()
      const drop = new Set(productIds)
      this.items = this.items.filter((i) => !drop.has(i.productId))
      this.persist()
    },
    clear() {
      this.items = []
      this.persist()
    },
    /**
     * Replaces every line with the account's cart as the server serves it
     * (fresh prices, unavailable products already dropped). Used once per
     * sign-in, after the local cart has been merged into it — see
     * `plugins/cart-sync.client.ts`.
     */
    applyServerCart(items: CartItem[]) {
      // The server stores ids and quantities only; keep what this device knew.
      const sources = new Map(this.items.map((item) => [item.productId, item.upsellSource]))
      this.items = items.map((item) => ({
        ...item,
        upsellSource: item.upsellSource ?? sources.get(item.productId),
        quantity: Math.max(1, Math.min(item.quantity, MAX_QTY)),
      }))
      this.loaded = true
      this.persist()
    },
  },
})
