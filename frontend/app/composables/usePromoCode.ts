import { useCartStore } from '~/stores/cart'

export interface PromoPreview {
  valid: true
  code: string
  description: string | null
  type: 'PERCENT' | 'FIXED'
  value: number
  discount: number
  freeDelivery: boolean
}

const STORAGE_KEY = 'promo:v1'

/**
 * Checkout promo code. The preview here is cosmetic — POST /orders re-evaluates
 * the code server-side, so a stale or exhausted code is caught at order time.
 *
 * The applied code is shared via `useState` and persisted so it survives the
 * cart → checkout navigation.
 */
export function usePromoCode() {
  const cart = useCartStore()
  const config = useRuntimeConfig()

  const code = useState<string>('promo-code', () => '')
  const preview = useState<PromoPreview | null>('promo-preview', () => null)
  const error = useState<string>('promo-error', () => '')
  const validating = useState<boolean>('promo-validating', () => false)

  async function validate(rawCode: string) {
    const trimmed = rawCode.trim()
    if (!trimmed) {
      clear()
      return false
    }

    validating.value = true
    error.value = ''
    try {
      const result = await $fetch<PromoPreview>(`${config.public.apiBase}/promo-codes/validate`, {
        method: 'POST',
        body: { code: trimmed, itemsTotal: cart.totalPrice },
      })
      preview.value = result
      code.value = result.code
      if (import.meta.client) sessionStorage.setItem(STORAGE_KEY, result.code)
      return true
    } catch (err) {
      const message = (err as { data?: { message?: string } }).data?.message
      error.value = message || 'Промокод недействителен'
      preview.value = null
      return false
    } finally {
      validating.value = false
    }
  }

  function clear() {
    code.value = ''
    preview.value = null
    error.value = ''
    if (import.meta.client) sessionStorage.removeItem(STORAGE_KEY)
  }

  /** Re-checks a previously applied code — cart totals may have changed. */
  async function restore() {
    if (!import.meta.client || preview.value) return
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved && !cart.isEmpty) await validate(saved)
  }

  const discount = computed(() => preview.value?.discount ?? 0)
  const freeDelivery = computed(() => preview.value?.freeDelivery ?? false)

  return { code, preview, error, validating, discount, freeDelivery, validate, clear, restore }
}
