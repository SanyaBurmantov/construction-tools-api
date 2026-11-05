/**
 * Goals and e-commerce for Yandex Metrika (counter 113800110, snippet in
 * `nuxt.config.ts`). Advertising learns from these — orders and requests for
 * an invoice, not clicks — so every call is client-only and never throws:
 * without the counter (dev, an ad blocker, the admin panel) nothing happens.
 *
 * Each goal id here is a Metrika «JavaScript-событие» goal with the same
 * identifier (`backend/scripts/metrika-goals.mjs` creates them). Renaming one
 * here silently stops its goal counting — add a new id instead.
 */
const METRIKA_ID = 113800110

export type MetrikaGoal =
  /** An order placed (any payment). Carries `order_price`. */
  | 'order'
  /** An order paid by invoice — a company. Carries `order_price`. */
  | 'order_invoice'
  /** The commercial-offer PDF downloaded. */
  | 'quote'
  /** «Уточнить наличие / подобрать аналог» or the form for organisations. */
  | 'lead'
  /** An account created… */
  | 'register'
  /** …by a company (юрлицо / ИП). */
  | 'register_company'
  /** The XLSX price list downloaded. */
  | 'price_list'
  /** A product put in the cart. */
  | 'add_to_cart'
  /** The checkout opened. */
  | 'checkout'
  /** A click on the phone number… */
  | 'phone_click'
  /** …or on Viber / Telegram / WhatsApp. */
  | 'messenger_click'

type Ym = (...args: unknown[]) => void

export function reachGoal(goal: MetrikaGoal, params?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  const ym = (window as unknown as { ym?: Ym }).ym
  if (typeof ym !== 'function') return
  try {
    ym(METRIKA_ID, 'reachGoal', goal, params)
  } catch {
    /* analytics never breaks the page */
  }
}

export type EcommerceProduct = {
  id: string
  name: string
  price: number
  quantity: number
  brand?: string
  category?: string
}

/**
 * Metrika e-commerce (`ecommerce: 'dataLayer'` in the snippet): what was put
 * in the cart and what was bought, with prices — the revenue reports and the
 * ad systems' optimisation by sales read this.
 */
export function ecommerce(
  event: 'add' | 'purchase',
  products: EcommerceProduct[],
  orderId?: string,
) {
  if (typeof window === 'undefined' || !products.length) return
  try {
    const w = window as unknown as { dataLayer?: unknown[] }
    w.dataLayer = w.dataLayer || []
    w.dataLayer.push({
      ecommerce: {
        currencyCode: 'BYN',
        [event]: {
          ...(event === 'purchase' && orderId ? { actionField: { id: orderId } } : {}),
          products,
        },
      },
    })
  } catch {
    /* analytics never breaks the page */
  }
}

/** Cart lines as e-commerce products. */
export function cartProducts(items: Array<{ productId: string, name: string, price: number, quantity: number }>) {
  return items.map(i => ({ id: i.productId, name: i.name, price: i.price, quantity: i.quantity }))
}
