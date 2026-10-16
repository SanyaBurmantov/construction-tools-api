import { defineStore } from 'pinia'
import { readArray, writeJson } from '~/utils/safe-storage'

export interface CompareItem {
  productId: string
  slug: string
  name: string
  image: string | null
  price: number | null
  oldPrice: number | null
  currency: string
  categorySlug: string | null
  categoryName: string | null
}

const STORAGE_KEY = 'compare:v1'
/** More than four columns stops being readable on a laptop screen. */
export const COMPARE_LIMIT = 4

export const useCompareStore = defineStore('compare', {
  state: () => ({
    items: [] as CompareItem[],
    loaded: false,
  }),
  getters: {
    count: (state) => state.items.length,
    isEmpty: (state) => state.items.length === 0,
    has: (state) => (productId: string) =>
      state.items.some((i) => i.productId === productId),
    slugs: (state) => state.items.map((i) => i.slug),
  },
  actions: {
    load() {
      if (this.loaded || !import.meta.client) return
      this.items = readArray<CompareItem>(STORAGE_KEY).slice(0, COMPARE_LIMIT)
      this.loaded = true
    },
    persist() {
      writeJson(STORAGE_KEY, this.items)
    },
    /** Returns false when the list is already full. */
    add(item: CompareItem) {
      if (this.has(item.productId)) return true
      if (this.items.length >= COMPARE_LIMIT) return false
      this.items = [...this.items, item]
      this.persist()
      return true
    },
    remove(productId: string) {
      this.items = this.items.filter((i) => i.productId !== productId)
      this.persist()
    },
    /** `'added' | 'removed' | 'full'` so the caller can pick the right message. */
    toggle(item: CompareItem) {
      if (this.has(item.productId)) {
        this.remove(item.productId)
        return 'removed' as const
      }
      return this.add(item) ? ('added' as const) : ('full' as const)
    },
    clear() {
      this.items = []
      this.persist()
    },
    /** The account's comparison as the server serves it — see the wishlist. */
    applyServerList(items: CompareItem[]) {
      this.items = items.slice(0, COMPARE_LIMIT)
      this.loaded = true
      this.persist()
    },
  },
})
