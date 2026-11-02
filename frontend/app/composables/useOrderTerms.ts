import type { DeliveryMethod } from '~/types/api'

/**
 * The terms of sale, said on the storefront: the minimum order (individuals
 * and organisations) and what delivery costs. The API enforces the same rules
 * (backend `orders/order-terms.ts`) from the same env values — this is only
 * what the customer sees before submitting.
 */
export function useOrderTerms() {
  const config = useRuntimeConfig().public
  const terms = {
    courier: Number(config.deliveryCourier),
    post: Number(config.deliveryPost),
    minIndividual: Number(config.minOrderIndividual),
    minCompany: Number(config.minOrderCompany),
    freeDeliveryCompanyFrom: Number(config.freeDeliveryCompanyFrom),
  }

  const minimumFor = (isCompany: boolean) =>
    isCompany ? terms.minCompany : terms.minIndividual

  /** `goodsTotal` is after the promo discount, as on the server. */
  const deliveryFor = (method: DeliveryMethod, isCompany: boolean, goodsTotal: number) => {
    if (method === 'PICKUP') return 0
    if (isCompany && goodsTotal >= terms.freeDeliveryCompanyFrom) return 0
    return method === 'COURIER' ? terms.courier : terms.post
  }

  return { terms, minimumFor, deliveryFor }
}
