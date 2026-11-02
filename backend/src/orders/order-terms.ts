import { DeliveryMethod } from '@prisma/client';

/**
 * The shop's terms of sale (owner, 2026-11-02): individuals order from
 * 200 BYN, organisations (paying by invoice) from 50 BYN; courier 20 BYN,
 * post 10 BYN, pickup free — and delivery is free for an organisation whose
 * goods come to 300 BYN or more. Every number can be moved with an env var;
 * the storefront reads the same ones (`NUXT_PUBLIC_*` in docker-compose.prod).
 * Pure, so the rules are tested without a database.
 */
export type OrderTerms = {
  minIndividual: number;
  minCompany: number;
  freeDeliveryCompanyFrom: number;
  courier: number;
  post: number;
};

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed)
    ? parsed
    : fallback;
};

export function orderTerms(env: NodeJS.ProcessEnv = process.env): OrderTerms {
  return {
    minIndividual: num(env.ORDER_MIN_INDIVIDUAL, 200),
    minCompany: num(env.ORDER_MIN_COMPANY, 50),
    freeDeliveryCompanyFrom: num(env.FREE_DELIVERY_COMPANY_FROM, 300),
    courier: num(env.DELIVERY_COST_COURIER, 20),
    post: num(env.DELIVERY_COST_POST, 10),
  };
}

/** The smallest goods total an order may have. */
export function orderMinimum(terms: OrderTerms, isCompany: boolean): number {
  return isCompany ? terms.minCompany : terms.minIndividual;
}

/** What delivery costs; `goodsTotal` is after any promo discount. */
export function deliveryCostFor(
  terms: OrderTerms,
  method: DeliveryMethod,
  isCompany: boolean,
  goodsTotal: number,
): number {
  if (method === 'PICKUP') return 0;
  if (isCompany && goodsTotal >= terms.freeDeliveryCompanyFrom) return 0;
  return method === 'COURIER' ? terms.courier : terms.post;
}
