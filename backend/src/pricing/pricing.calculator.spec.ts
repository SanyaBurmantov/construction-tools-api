import { PricingRule } from '@prisma/client';
import {
  applyRounding,
  computePrice,
  isSuspiciousCostChange,
  margin,
  resolveRule,
} from './pricing.calculator';

function rule(overrides: Partial<PricingRule> = {}): PricingRule {
  return {
    id: 'r1',
    name: 'Правило',
    scope: 'GLOBAL',
    categoryId: null,
    brandId: null,
    sourceId: null,
    minCost: null,
    maxCost: null,
    markupPercent: 30,
    markupFixed: 0,
    minMargin: null,
    rounding: 'NONE',
    priority: 0,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

const context = {
  categoryIds: ['cat-child', 'cat-parent'],
  brandId: 'brand-1',
  sourceIds: ['src-1'],
};

describe('computePrice', () => {
  it('applies a percentage markup', () => {
    expect(computePrice(100, rule({ markupPercent: 30 }))).toBe(130);
  });

  it('adds the flat markup on top of the percentage', () => {
    expect(computePrice(100, rule({ markupPercent: 30, markupFixed: 5 }))).toBe(
      135,
    );
  });

  it('lifts the price to satisfy the minimum absolute margin', () => {
    // 10% of 100 is only 10, but the rule demands at least 40.
    expect(computePrice(100, rule({ markupPercent: 10, minMargin: 40 }))).toBe(
      140,
    );
  });

  it('leaves the price alone when the margin already clears the floor', () => {
    expect(computePrice(100, rule({ markupPercent: 50, minMargin: 40 }))).toBe(
      150,
    );
  });

  it('falls back to the bare cost when no rule matches', () => {
    expect(computePrice(100, null)).toBe(100);
  });

  it('returns zero for a missing or invalid cost', () => {
    expect(computePrice(0, rule())).toBe(0);
    expect(computePrice(Number.NaN, rule())).toBe(0);
  });

  // Charm rounding subtracts, so it must not drag the price below cost.
  it('never prices below cost', () => {
    const price = computePrice(
      100,
      rule({ markupPercent: 0, rounding: 'CHARM_90' }),
    );
    expect(price).toBeGreaterThanOrEqual(100);
  });
});

describe('applyRounding', () => {
  it('rounds to charm .90 endings', () => {
    expect(applyRounding(149.2, 'CHARM_90')).toBe(149.9);
    expect(applyRounding(149.95, 'CHARM_90')).toBe(149.9);
  });

  it('rounds to charm .99 endings', () => {
    expect(applyRounding(149.2, 'CHARM_99')).toBe(149.99);
  });

  it('rounds up to whole units', () => {
    expect(applyRounding(149.01, 'INTEGER')).toBe(150);
  });

  it('rounds up to tens', () => {
    expect(applyRounding(141, 'TENS')).toBe(150);
    expect(applyRounding(150, 'TENS')).toBe(150);
  });

  it('keeps two decimals when rounding is off', () => {
    expect(applyRounding(149.239, 'NONE')).toBe(149.24);
  });
});

describe('resolveRule', () => {
  it('prefers a more specific scope over a global rule', () => {
    const global = rule({ id: 'global' });
    const brand = rule({ id: 'brand', scope: 'BRAND', brandId: 'brand-1' });

    expect(resolveRule([global, brand], 100, context)!.id).toBe('brand');
  });

  it('orders scopes source > brand > category > global', () => {
    const rules = [
      rule({ id: 'global' }),
      rule({ id: 'category', scope: 'CATEGORY', categoryId: 'cat-child' }),
      rule({ id: 'brand', scope: 'BRAND', brandId: 'brand-1' }),
      rule({ id: 'source', scope: 'SOURCE', sourceId: 'src-1' }),
    ];

    expect(resolveRule(rules, 100, context)!.id).toBe('source');
  });

  // A rule on a parent category must cover everything beneath it.
  it('matches a category rule set on an ancestor', () => {
    const parentRule = rule({
      id: 'parent',
      scope: 'CATEGORY',
      categoryId: 'cat-parent',
    });

    expect(resolveRule([parentRule], 100, context)!.id).toBe('parent');
  });

  it('ignores rules whose cost band excludes the cost', () => {
    const cheap = rule({ id: 'cheap', maxCost: 50 });
    const pricey = rule({ id: 'pricey', minCost: 500 });

    expect(resolveRule([cheap, pricey], 100, context)).toBeNull();
  });

  it('ignores inactive rules', () => {
    const off = rule({
      id: 'off',
      scope: 'BRAND',
      brandId: 'brand-1',
      isActive: false,
    });
    const global = rule({ id: 'global' });

    expect(resolveRule([off, global], 100, context)!.id).toBe('global');
  });

  it('breaks a scope tie by priority', () => {
    const low = rule({ id: 'low', priority: 1 });
    const high = rule({ id: 'high', priority: 9 });

    expect(resolveRule([low, high], 100, context)!.id).toBe('high');
  });

  it('prefers the narrower cost band at equal scope and priority', () => {
    const wide = rule({ id: 'wide' });
    const narrow = rule({ id: 'narrow', minCost: 90, maxCost: 110 });

    expect(resolveRule([wide, narrow], 100, context)!.id).toBe('narrow');
  });

  it('returns null when nothing matches', () => {
    const other = rule({ id: 'other', scope: 'BRAND', brandId: 'brand-999' });
    expect(resolveRule([other], 100, context)).toBeNull();
  });
});

describe('margin', () => {
  it('reports absolute and percentage margin', () => {
    expect(margin(130, 100)).toEqual({ absolute: 30, percent: 30 });
  });

  it('returns nulls when either side is unknown', () => {
    expect(margin(null, 100).percent).toBeNull();
    expect(margin(130, null).percent).toBeNull();
    expect(margin(130, 0).percent).toBeNull();
  });
});

describe('isSuspiciousCostChange', () => {
  it('accepts an ordinary fluctuation', () => {
    expect(isSuspiciousCostChange(100, 110, 50)).toBe(false);
  });

  // A supplier typo (×10) is the case this exists for.
  it('flags a tenfold jump', () => {
    expect(isSuspiciousCostChange(100, 1000, 50)).toBe(true);
  });

  it('flags a collapse to near zero', () => {
    expect(isSuspiciousCostChange(100, 1, 50)).toBe(true);
    expect(isSuspiciousCostChange(100, 0, 50)).toBe(true);
  });

  it('never flags the very first cost', () => {
    expect(isSuspiciousCostChange(null, 1000, 50)).toBe(false);
    expect(isSuspiciousCostChange(0, 1000, 50)).toBe(false);
  });
});
