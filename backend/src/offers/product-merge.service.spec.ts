import { mergedState } from './product-merge.service';

const side = (overrides: Partial<Parameters<typeof mergedState>[0]> = {}) => ({
  sku: null,
  barcode: null,
  model: null,
  brandId: null,
  descriptionShort: null,
  descriptionFull: null,
  status: 'PUBLISHED' as const,
  statusSource: 'SYSTEM' as const,
  pricingMode: 'AUTO' as const,
  priceValue: 100,
  oldPrice: null,
  priceReviewNeeded: false,
  aiLockedFields: [] as string[],
  lockedFields: [] as string[],
  ...overrides,
});

describe('mergedState', () => {
  it('fills identity gaps from the duplicate', () => {
    expect(
      mergedState(side({ sku: 'A' }), side({ sku: 'B', barcode: '460' })),
    ).toMatchObject({ sku: 'A', barcode: '460' });
  });

  // The duplicate row is deleted; an admin's price must not go with it.
  it('keeps a MANUAL price set on the duplicate', () => {
    expect(
      mergedState(
        side(),
        side({ pricingMode: 'MANUAL', priceValue: 77, oldPrice: 90 }),
      ),
    ).toMatchObject({ pricingMode: 'MANUAL', priceValue: 77, oldPrice: 90 });
  });

  it('keeps the target’s own MANUAL price over the duplicate’s', () => {
    const state = mergedState(
      side({ pricingMode: 'MANUAL', priceValue: 50 }),
      side({ pricingMode: 'MANUAL', priceValue: 77 }),
    );
    expect(state).not.toHaveProperty('priceValue');
  });

  it('unions AI and admin field locks', () => {
    expect(
      mergedState(
        side({ lockedFields: ['name'], aiLockedFields: ['seoTitle'] }),
        side({ lockedFields: ['categoryId'], aiLockedFields: ['seoTitle'] }),
      ),
    ).toMatchObject({
      lockedFields: ['name', 'categoryId'],
      aiLockedFields: ['seoTitle'],
    });
  });

  it('publishes a survivor the system had parked when the duplicate was live', () => {
    expect(
      mergedState(side({ status: 'HIDDEN' }), side({ status: 'PUBLISHED' })),
    ).toMatchObject({ status: 'PUBLISHED' });
  });

  it('never overrides a status an admin set', () => {
    const state = mergedState(
      side({ status: 'HIDDEN', statusSource: 'ADMIN' }),
      side({ status: 'PUBLISHED' }),
    );
    expect(state).not.toHaveProperty('status');
  });
});
