export type ServerCartLine = {
  productId: string
  slug: string
  name: string
  sku: string | null
  image: string | null
  price: number | null
  oldPrice: number | null
  currency: string
  stockStatus: string | null
  quantity: number
}

export type ServerCart = {
  items: ServerCartLine[]
  dropped: Array<{ productId: string, name: string | null, reason: 'unavailable' }>
  updatedAt: string | null
}

export type CartPayloadItem = { productId: string, quantity: number }

/**
 * The account's stored cart (`/cart` on the API).
 *
 * It is a backup, not the cart the UI renders: the Pinia store in
 * localStorage stays the source of truth on the device, this keeps a copy so
 * the cart survives a new device or a cleared browser. Guests never touch it.
 */
export function useServerCart() {
  const { authFetch } = useAuth()

  const fetchCart = () => authFetch<ServerCart>('/cart')

  /** Sign-in step: union of the browser cart and the stored one. */
  const mergeLocal = (items: CartPayloadItem[]) =>
    authFetch<ServerCart>('/cart/merge', { method: 'POST', body: { items } })

  /** Mirrors a local change up. Last write wins. */
  const replace = (items: CartPayloadItem[]) =>
    authFetch<ServerCart>('/cart', { method: 'PUT', body: { items } })

  const clear = () => authFetch<{ ok: boolean }>('/cart', { method: 'DELETE' })

  return { fetchCart, mergeLocal, replace, clear }
}
