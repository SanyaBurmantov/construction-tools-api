import { useCartStore } from '~/stores/cart'
import { readJson, removeStored, writeJson } from '~/utils/safe-storage'

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
      writeJson(STORAGE_KEY, result.code, 'session')
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
    removeStored(STORAGE_KEY, 'session')
  }

  /** Re-checks a previously applied code — cart totals may have changed. */
  async function restore() {
    if (!import.meta.client || preview.value) return
    const saved = readJson<string>(STORAGE_KEY, 'session')
    if (typeof saved === 'string' && saved && !cart.isEmpty) await validate(saved)
  }

  /**
   * A changed subtotal can invalidate a min-order code, so an applied code is
   * re-checked on every edit — on the cart and on checkout alike. Scoped to the
   * calling component, so each screen that shows the code keeps it honest.
   */
  function watchCartTotal() {
    watch(
      () => cart.totalPrice,
      async () => {
        if (preview.value) await validate(code.value)
      }
    )
  }

  const discount = computed(() => preview.value?.discount ?? 0)
  const freeDelivery = computed(() => preview.value?.freeDelivery ?? false)

  return {
    code,
    preview,
    error,
    validating,
    discount,
    freeDelivery,
    validate,
    clear,
    restore,
    watchCartTotal,
  }
}
