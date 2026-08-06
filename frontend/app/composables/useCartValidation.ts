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

export interface CartValidation {
  items: ValidatedCartItem[]
  itemsTotal: number
  currency: string
  ok: boolean
  hasBlocking: boolean
  hasPriceChanges: boolean
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
  const validating = useState('cart-validating', () => false)
  const failed = useState('cart-validation-failed', () => false)

  async function validate() {
    if (cart.isEmpty) {
      validation.value = null
      return null
    }

    validating.value = true
    failed.value = false
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
      failed.value = true
      validation.value = null
      return null
    } finally {
      validating.value = false
    }
  }

  const changedItems = computed(
    () => validation.value?.items.filter((i) => i.issue === 'price_changed') ?? []
  )
  const unavailableItems = computed(
    () =>
      validation.value?.items.filter(
        (i) => i.issue === 'unavailable' || i.issue === 'price_missing'
      ) ?? []
  )
  const backorderItems = computed(
    () => validation.value?.items.filter((i) => i.issue === 'out_of_stock') ?? []
  )

  /** The server-confirmed subtotal, falling back to the local one. */
  const itemsTotal = computed(() => validation.value?.itemsTotal ?? cart.totalPrice)

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
    validation,
    validating,
    failed,
    changedItems,
    unavailableItems,
    backorderItems,
    itemsTotal,
    validate,
    acceptPrices,
    removeUnavailable,
  }
}
