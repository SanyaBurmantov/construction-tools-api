import { useCartStore } from '~/stores/cart'

export type CartIssue =
  | 'unavailable'
  | 'price_changed'
  | 'price_missing'
  | 'out_of_stock'

export interface ValidatedCartItem {
  productId: string
  quantity: number
  issue: CartIssue | null
  clientPrice: number | null
  price: number | null
  oldPrice: number | null
  currency: string
  name: string | null
  slug: string | null
  image: string | null
  stockStatus: string | null
  lineTotal: number
}

/** The part of the `POST /cart/validate` answer the storefront reads. */
export interface CartValidation {
  items: ValidatedCartItem[]
}

/**
 * Re-prices the local cart against the API.
 *
 * The cart stores the price captured when an item was added; supplier prices
 * are re-parsed daily, so a cart restored from localStorage can be stale.
 * Calling this on the cart and checkout screens surfaces the difference before
 * the customer commits, rather than letting the order total silently differ.
 */
export function useCartValidation() {
  const cart = useCartStore()
  const config = useRuntimeConfig()

  const validation = useState<CartValidation | null>('cart-validation', () => null)

  async function validate() {
    if (cart.isEmpty) {
      validation.value = null
      return null
    }

    try {
      const result = await $fetch<CartValidation>(
        `${config.public.apiBase}/cart/validate`,
        {
          method: 'POST',
          body: {
            items: cart.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price,
            })),
          },
        }
      )
      validation.value = result
      return result
    } catch {
      // A failed check must not block checkout — the server re-prices the
      // order anyway, and rejects it if the total moved.
      validation.value = null
      return null
    }
  }

  /**
   * The answer describes the cart as it was when it was sent; a line removed
   * since then must not keep its warning (or block checkout).
   */
  const linesInCart = computed(() => {
    const ids = new Set(cart.items.map((item) => item.productId))
    return validation.value?.items.filter((i) => ids.has(i.productId)) ?? []
  })

  const changedItems = computed(() =>
    linesInCart.value.filter((i) => i.issue === 'price_changed')
  )
  const unavailableItems = computed(() =>
    linesInCart.value.filter((i) => i.issue === 'unavailable' || i.issue === 'price_missing')
  )
  const backorderItems = computed(() =>
    linesInCart.value.filter((i) => i.issue === 'out_of_stock')
  )

  /** Accepts the new prices into the local cart and clears the warning. */
  function acceptPrices() {
    const updates = changedItems.value
      .filter((i) => i.price != null)
      .map((i) => ({
        productId: i.productId,
        price: i.price as number,
        currency: i.currency,
      }))
    cart.applyPrices(updates)
    return validate()
  }

  function removeUnavailable() {
    cart.removeMany(unavailableItems.value.map((i) => i.productId))
    return validate()
  }

  return {
    changedItems,
    unavailableItems,
    backorderItems,
    validate,
    acceptPrices,
    removeUnavailable,
  }
}
