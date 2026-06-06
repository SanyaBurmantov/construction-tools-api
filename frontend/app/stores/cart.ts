import { defineStore } from 'pinia'

export interface CartItem {
  productId: string
  slug: string
  name: string
  sku?: string | null
  image: string | null
  price: number
  currency: string
  quantity: number
}

const STORAGE_KEY = 'cart:v1'
const MAX_QTY = 999

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
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) this.items = parsed
        }
      } catch {
        this.items = []
      }
      this.loaded = true
    },
    persist() {
      if (!import.meta.client) return
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items))
    },
    add(item: Omit<CartItem, 'quantity'>, quantity = 1) {
      const existing = this.items.find((i) => i.productId === item.productId)
      if (existing) {
        existing.quantity = Math.min(existing.quantity + quantity, MAX_QTY)
      } else {
        this.items.push({ ...item, quantity: Math.min(quantity, MAX_QTY) })
      }
      this.persist()
    },
    setQuantity(productId: string, quantity: number) {
      const item = this.items.find((i) => i.productId === productId)
      if (!item) return
      const next = Math.max(1, Math.min(Math.floor(quantity) || 1, MAX_QTY))
      item.quantity = next
      this.persist()
    },
    remove(productId: string) {
      this.items = this.items.filter((i) => i.productId !== productId)
      this.persist()
    },
    clear() {
      this.items = []
      this.persist()
    },
  },
})
