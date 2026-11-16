import { useCartStore } from '~/stores/cart'
import type { PromoCodeOffer } from '~/types/api'
import { pickAutoPromo } from '~/utils/auto-promo'
import { readArray, readJson, removeStored, writeJson } from '~/utils/safe-storage'

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
/** Set while the applied code is an auto-applied one. */
const AUTO_KEY = 'promo-auto:v1'
/** Codes the customer took off by hand — never put back automatically. */
const DISMISSED_KEY = 'promo-dismissed:v1'

/**
 * Checkout promo code. The preview here is cosmetic — POST /orders re-evaluates
 * the code server-side, so a stale or exhausted code is caught at order time.
 *
 * The applied code is shared via `useState` and persisted so it survives the
 * cart → checkout navigation.
 *
 * **Auto-apply**: with no code applied, the best advertised code
 * (`GET /promo-codes/public`, the home page's strip) is applied by itself —
 * the customer should not lose the discount for not typing it. Taking it off
 * with ✕ is remembered for the tab's session, and an auto-applied code that
 * stops fitting the cart drops out quietly instead of showing an error the
 * customer never caused.
 */
export function usePromoCode() {
  const cart = useCartStore()
  const config = useRuntimeConfig()

  const code = useState<string>('promo-code', () => '')
  const preview = useState<PromoPreview | null>('promo-preview', () => null)
  const error = useState<string>('promo-error', () => '')
  const validating = useState<boolean>('promo-validating', () => false)
  /** The applied code came from auto-apply, not from the customer. */
  const auto = useState<boolean>('promo-auto', () => false)
  /** `GET /promo-codes/public`, fetched once per visit. */
  const offers = useState<PromoCodeOffer[] | null>('promo-offers', () => null)

  async function validate(rawCode: string, options: { auto?: boolean } = {}) {
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
      auto.value = Boolean(options.auto)
      writeJson(STORAGE_KEY, result.code, 'session')
      if (auto.value) writeJson(AUTO_KEY, true, 'session')
      else removeStored(AUTO_KEY, 'session')
      return true
    } catch (err) {
      const message = (err as { data?: { message?: string } }).data?.message
      // The code is no longer applied — drop it entirely. Kept, it was still
      // sent with the order: refused there («действует от 100 BYN»), or —
      // once the cart grew back — discounted by the server while the screen,
      // with no preview, showed the full price.
      code.value = ''
      preview.value = null
      removeStored(STORAGE_KEY, 'session')
      removeStored(AUTO_KEY, 'session')
      error.value = options.auto ? '' : message || 'Промокод недействителен'
      auto.value = false
      return false
    } finally {
      validating.value = false
    }
  }

  function clear() {
    code.value = ''
    preview.value = null
    error.value = ''
    auto.value = false
    removeStored(STORAGE_KEY, 'session')
    removeStored(AUTO_KEY, 'session')
  }

  /** ✕ on the applied code: also keeps auto-apply from putting it back. */
  function dismiss() {
    const current = code.value
    clear()
    if (!current) return
    const dismissed = readArray<string>(DISMISSED_KEY, 'session')
    if (!dismissed.includes(current)) writeJson(DISMISSED_KEY, [...dismissed, current], 'session')
  }

  /**
   * Applies the best advertised code when none is applied. Quiet on every
   * failure: no list, nothing fits, or the server refuses — the cart simply
   * stays without a code, exactly as before.
   */
  async function autoApply() {
    if (!import.meta.client || preview.value || validating.value || cart.isEmpty) return
    if (offers.value === null) {
      const answer = await $fetch<{ data: PromoCodeOffer[] }>(`${config.public.apiBase}/promo-codes/public`).catch(
        () => null
      )
      // A failed fetch is not cached, so the next screen tries again.
      if (!answer) return
      offers.value = answer.data
    }
    const pick = pickAutoPromo(offers.value, cart.totalPrice, readArray<string>(DISMISSED_KEY, 'session'))
    if (pick && !preview.value) await validate(pick.code, { auto: true })
  }

  /** Re-checks a previously applied code — cart totals may have changed. */
  async function restore() {
    if (!import.meta.client || preview.value) return
    const saved = readJson<string>(STORAGE_KEY, 'session')
    if (typeof saved === 'string' && saved && !cart.isEmpty) {
      await validate(saved, { auto: readJson<boolean>(AUTO_KEY, 'session') === true })
    }
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
        if (preview.value) await validate(code.value, { auto: auto.value })
        // Grown past an advertised code's minimum, or the auto code just
        // dropped out and another one fits.
        if (!preview.value) await autoApply()
      }
    )
  }

  /** The code the order should carry: only one the API has just accepted. */
  const appliedCode = computed(() => preview.value?.code ?? '')
  const discount = computed(() => preview.value?.discount ?? 0)
  const freeDelivery = computed(() => preview.value?.freeDelivery ?? false)

  return {
    code,
    appliedCode,
    preview,
    error,
    validating,
    auto,
    discount,
    freeDelivery,
    validate,
    clear,
    dismiss,
    restore,
    autoApply,
    watchCartTotal,
  }
}
