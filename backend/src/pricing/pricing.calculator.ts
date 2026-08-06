import { PricingRule, PricingScope, RoundingMode } from '@prisma/client';

/**
 * Pure pricing logic — no database, no Nest. Kept separate from the service so
 * the arithmetic that decides every storefront price is trivially testable.
 */

export type RuleContext = {
  categoryIds: string[];
  brandId: string | null;
  sourceIds: string[];
};

/** How specific a rule is; higher wins when several match. */
const SCOPE_WEIGHT: Record<PricingScope, number> = {
  SOURCE: 3,
  BRAND: 2,
  CATEGORY: 1,
  GLOBAL: 0,
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function ruleMatches(
  rule: PricingRule,
  cost: number,
  context: RuleContext,
): boolean {
  if (!rule.isActive) return false;
  if (rule.minCost != null && cost < rule.minCost) return false;
  if (rule.maxCost != null && cost > rule.maxCost) return false;

  switch (rule.scope) {
    case 'CATEGORY':
      // categoryIds carries the product's category *and its ancestors*, so a
      // rule on a parent category covers the whole subtree.
      return Boolean(
        rule.categoryId && context.categoryIds.includes(rule.categoryId),
      );
    case 'BRAND':
      return Boolean(rule.brandId && rule.brandId === context.brandId);
    case 'SOURCE':
      return Boolean(
        rule.sourceId && context.sourceIds.includes(rule.sourceId),
      );
    case 'GLOBAL':
    default:
      return true;
  }
}

/**
 * Picks the winning rule: most specific scope, then highest priority, then the
 * narrowest cost band (a rule written for a tight band is the more deliberate
 * one), then the newest.
 */
export function resolveRule(
  rules: PricingRule[],
  cost: number,
  context: RuleContext,
): PricingRule | null {
  const matching = rules.filter((rule) => ruleMatches(rule, cost, context));
  if (!matching.length) return null;

  const bandWidth = (rule: PricingRule) => {
    const min = rule.minCost ?? 0;
    const max = rule.maxCost ?? Number.POSITIVE_INFINITY;
    return max - min;
  };

  return matching.sort((a, b) => {
    const scope = SCOPE_WEIGHT[b.scope] - SCOPE_WEIGHT[a.scope];
    if (scope !== 0) return scope;
    if (b.priority !== a.priority) return b.priority - a.priority;
    const band = bandWidth(a) - bandWidth(b);
    if (band !== 0) return band;
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0];
}

export function applyRounding(value: number, mode: RoundingMode): number {
  switch (mode) {
    case 'INTEGER':
      return Math.ceil(value);
    case 'TENS':
      return Math.ceil(value / 10) * 10;
    case 'CHARM_90': {
      // Round up to the next whole unit, then drop 10 kopecks: 149.2 -> 149.90.
      const whole = Math.ceil(value);
      return round2(whole - 0.1);
    }
    case 'CHARM_99': {
      const whole = Math.ceil(value);
      return round2(whole - 0.01);
    }
    case 'NONE':
    default:
      return round2(value);
  }
}

/**
 * Cost → storefront price: percentage markup, flat markup, a floor on absolute
 * margin, then rounding. Never returns a price below cost.
 */
export function computePrice(cost: number, rule: PricingRule | null): number {
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  if (!rule) return round2(cost);

  let price = cost * (1 + rule.markupPercent / 100) + rule.markupFixed;

  if (rule.minMargin != null && price - cost < rule.minMargin) {
    price = cost + rule.minMargin;
  }

  price = applyRounding(price, rule.rounding);

  // Rounding down (CHARM_90 on a value just above a whole unit) must never
  // push the price under cost.
  return price < cost ? round2(cost) : price;
}

export function margin(price: number | null, cost: number | null) {
  if (price == null || cost == null || cost <= 0) {
    return { absolute: null, percent: null };
  }
  const absolute = round2(price - cost);
  return { absolute, percent: round2((absolute / cost) * 100) };
}

/**
 * True when a cost change is too large to trust — usually a supplier typo or a
 * parser picking up the wrong element. Such products keep their old price and
 * get flagged instead of going live with a broken one.
 */
export function isSuspiciousCostChange(
  previousCost: number | null | undefined,
  nextCost: number,
  thresholdPercent: number,
): boolean {
  if (previousCost == null || previousCost <= 0) return false;
  if (nextCost <= 0) return true;
  const change = (Math.abs(nextCost - previousCost) / previousCost) * 100;
  return change > thresholdPercent;
}
