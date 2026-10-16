import { readArray, writeJson } from '~/utils/safe-storage'

export interface ViewedProduct {
  slug: string
  name: string
  image: string | null
  price: number | null
  currency: string
  viewedAt: number
}

const STORAGE_KEY = 'viewed:v1'
const MAX_ITEMS = 12

/**
 * "Вы смотрели" — a browsing aid every Belarusian catalogue has, because tool
 * buyers compare several similar items across visits.
 *
 * Client-only and localStorage-backed, like the cart and wishlist.
 */
export function useRecentlyViewed() {
  const items = useState<ViewedProduct[]>('recently-viewed', () => [])
  const loaded = useState('recently-viewed-loaded', () => false)

  function load() {
    if (loaded.value || !import.meta.client) return
    items.value = readArray<ViewedProduct>(STORAGE_KEY)
    loaded.value = true
  }

  // Browsing keeps working when storage is blocked or full — writeJson never throws.
  const persist = () => writeJson(STORAGE_KEY, items.value)

  /** Records a view, moving an already-seen product back to the front. */
  function track(product: Omit<ViewedProduct, 'viewedAt'>) {
    if (!import.meta.client) return
    load()
    items.value = [
      { ...product, viewedAt: Date.now() },
      ...items.value.filter((item) => item.slug !== product.slug),
    ].slice(0, MAX_ITEMS)
    persist()
  }

  function clear() {
    items.value = []
    persist()
  }

  onMounted(load)

  return { items, track, clear }
}
