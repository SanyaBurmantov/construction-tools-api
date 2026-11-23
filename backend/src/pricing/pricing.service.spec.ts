import { PricingRule } from '@prisma/client';
import { PricingService } from './pricing.service';
import { PrismaService } from '../prisma/prisma.service';

type ProductRow = {
  id: string;
  categoryId: string | null;
  brandId: string | null;
  costPrice: number | null;
  priceValue: number | null;
  oldPrice: number | null;
  pricingMode: 'AUTO' | 'MANUAL';
  priceReviewNeeded?: boolean;
  sourceProducts: { sourceId: string }[];
};

function globalRule(overrides: Partial<PricingRule> = {}): PricingRule {
  return {
    id: 'rule-1',
    name: '+50%',
    scope: 'GLOBAL',
    categoryId: null,
    brandId: null,
    sourceId: null,
    minCost: null,
    maxCost: null,
    markupPercent: 50,
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

function buildService(
  product: ProductRow | null,
  rules: PricingRule[] = [globalRule()],
  lastHistory: { costPrice: number | null } | null = null,
) {
  const productUpdate = jest.fn(() => Promise.resolve({}));
  const historyCreate = jest.fn(() => Promise.resolve({}));

  const prisma = {
    product: {
      findUnique: jest.fn(() => Promise.resolve(product)),
      update: productUpdate,
    },
    pricingRule: {
      findMany: jest.fn(() => Promise.resolve(rules)),
    },
    category: {
      findUnique: jest.fn(() => Promise.resolve(null)),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    priceHistory: {
      create: historyCreate,
      findFirst: jest.fn(() => Promise.resolve(lastHistory)),
    },
    // Transactions run their operations eagerly in these mocks, so the calls
    // are already recorded by the time $transaction is invoked.
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
  } as unknown as PrismaService;

  return { service: new PricingService(prisma), productUpdate, historyCreate };
}

const baseProduct: ProductRow = {
  id: 'p1',
  categoryId: null,
  brandId: null,
  costPrice: 100,
  priceValue: 150,
  oldPrice: null,
  pricingMode: 'AUTO',
  sourceProducts: [],
};

describe('PricingService.applyCost', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('recomputes the storefront price from the new cost', async () => {
    const { service, productUpdate } = buildService({ ...baseProduct });

    const decision = await service.applyCost('p1', 120);

    expect(decision.reason).toBe('rule');
    expect(decision.price).toBe(180);
    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ costPrice: 120, priceValue: 180 }),
      }),
    );
  });

  // The whole point of MANUAL: a parser run must not undo an admin's price.
  it('keeps a MANUAL price and only records the new cost', async () => {
    const { service, productUpdate, historyCreate } = buildService({
      ...baseProduct,
      pricingMode: 'MANUAL',
    });

    const decision = await service.applyCost('p1', 120);

    expect(decision.reason).toBe('manual');
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { costPrice: 120 },
    });
    // The cost change is still written to history; the price is not moved.
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          costPrice: 120,
          oldPrice: 150,
          newPrice: 150,
        }),
      }),
    );
  });

  // No spike guard (owner, 2026-11-23): the supplier's price, both ways.
  it('applies a large drop at once', async () => {
    const { service, productUpdate } = buildService({ ...baseProduct });

    const decision = await service.applyCost('p1', 10);

    expect(decision.blocked).toBe(false);
    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ costPrice: 10 }),
      }),
    );
  });

  // A cost held before 2026-11-23 goes live on the next parse.
  it('applies a large rise at once and clears the review flag', async () => {
    const { service, productUpdate } = buildService({
      ...baseProduct,
      priceReviewNeeded: true,
    });

    const decision = await service.applyCost('p1', 1000);

    expect(decision.blocked).toBe(false);
    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          costPrice: 1000,
          priceReviewNeeded: false,
        }),
      }),
    );
  });

  // The supplier fixed its typo: "accept" must not adopt the stale value later.
  it('clears the review flag when a sane cost arrives', async () => {
    const { service, productUpdate } = buildService({
      ...baseProduct,
      priceReviewNeeded: true,
    });

    await service.applyCost('p1', 100);

    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { priceReviewNeeded: false },
    });
  });

  it('keeps the stored old price when asked to preserve it', async () => {
    const { service, productUpdate } = buildService({
      ...baseProduct,
      oldPrice: 300,
    });

    await service.applyCost('p1', 100, { preserveOldPrice: true });

    expect(productUpdate).not.toHaveBeenCalled();
  });

  it('accepts a large jump on a product that had no cost yet', async () => {
    const { service } = buildService({ ...baseProduct, costPrice: null });

    const decision = await service.applyCost('p1', 1000);

    expect(decision.blocked).toBe(false);
    expect(decision.price).toBe(1500);
  });

  it('writes nothing when neither cost nor price moved', async () => {
    const { service, productUpdate, historyCreate } = buildService({
      ...baseProduct,
      costPrice: 100,
      priceValue: 150,
    });

    await service.applyCost('p1', 100);

    expect(productUpdate).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
  });

  // Otherwise the "was" price would sit below our marked-up price and the
  // discount badge would misrepresent the saving.
  it('marks up the supplier old price with the same rule', async () => {
    const { service, productUpdate } = buildService({ ...baseProduct });

    await service.applyCost('p1', 100, { oldCost: 200 });

    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priceValue: 150, oldPrice: 300 }),
      }),
    );
  });

  it('ignores a supplier old price that is not actually higher', async () => {
    const { service, productUpdate } = buildService({ ...baseProduct });

    await service.applyCost('p1', 100, { oldCost: 80 });

    // Nothing moved and there was no stored discount, so there is nothing to write.
    expect(productUpdate).not.toHaveBeenCalled();
  });

  // A supplier that stops discounting must not leave a phantom "was" price.
  it('clears a stored old price once the supplier discount ends', async () => {
    const { service, productUpdate } = buildService({
      ...baseProduct,
      oldPrice: 300,
    });

    await service.applyCost('p1', 100);

    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ oldPrice: null }),
      }),
    );
  });

  it('does nothing for an unknown product', async () => {
    const { service, productUpdate } = buildService(null);

    await service.applyCost('missing', 100);

    expect(productUpdate).not.toHaveBeenCalled();
  });
});

describe('PricingService.preview', () => {
  it('returns the price, the winning rule and the margin', async () => {
    const { service } = buildService(null);

    const result = await service.preview({ cost: 100 });

    expect(result.price).toBe(150);
    expect(result.rule?.name).toBe('+50%');
    expect(result.margin).toEqual({ absolute: 50, percent: 50 });
  });

  it('falls back to cost when no rule is active', async () => {
    const { service } = buildService(null, []);

    const result = await service.preview({ cost: 100 });

    expect(result.price).toBe(100);
    expect(result.rule).toBeNull();
  });
});
