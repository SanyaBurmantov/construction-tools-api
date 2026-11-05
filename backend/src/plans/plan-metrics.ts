/**
 * What a goal in «Планы» can be measured by. Each value is counted live from
 * our own data, so a goal's progress is never typed in by hand and never goes
 * stale. Month measures are the current Minsk calendar month so far.
 *
 * A key is stored in `PlanItem.metric`: never rename one — add a new key.
 */
export const PLAN_METRICS = [
  { key: 'orders_month', label: 'Заказы за месяц', unit: 'шт.' },
  {
    key: 'company_orders_month',
    label: 'Заказы организаций за месяц',
    unit: 'шт.',
  },
  { key: 'revenue_month', label: 'Выручка за месяц', unit: 'BYN' },
  {
    key: 'profit_month',
    label: 'Прибыль за месяц (≈15% выручки)',
    unit: 'BYN',
  },
  { key: 'leads_month', label: 'Заявки за месяц', unit: 'шт.' },
  { key: 'visits_month', label: 'Визиты за месяц (люди)', unit: 'шт.' },
  { key: 'published_products', label: 'Товаров на витрине', unit: 'шт.' },
  {
    key: 'ai_text_products',
    label: 'Карточек с ИИ-текстами',
    unit: 'шт.',
  },
] as const;

export type PlanMetricKey = (typeof PLAN_METRICS)[number]['key'];

/**
 * The shop sells at the supplier's price and earns the supplier's purchase
 * discount — about 15% of a sale on average (owner, 2026-11-05).
 */
export const AVERAGE_PROFIT_SHARE = 0.15;

export function isPlanMetric(key: unknown): key is PlanMetricKey {
  return PLAN_METRICS.some((m) => m.key === key);
}

/** Share of the target reached, 0…1 (capped), or null without a target. */
export function planProgress(
  value: number | null | undefined,
  target: number | null | undefined,
): number | null {
  if (value == null || target == null || !(target > 0)) return null;
  return Math.min(1, Math.max(0, value / target));
}
