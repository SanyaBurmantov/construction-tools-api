import { mergedState } from './product-merge.service';

const side = (overrides: Partial<Parameters<typeof mergedState>[0]> = {}) => ({
  name: 'Дрель',
  categoryId: 'c1',
  seoTitle: null,
  seoDescription: null,
  variantLine: null,
  variantLabel: null,
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

  // The lock means «this text is ours»: without the text, the survivor's
  // supplier blurb would be published as our own SEO.
  it('brings the value of a field locked on the duplicate alone', () => {
    const state = mergedState(
      side({ seoTitle: 'Дрель купить в Минске ☎' }),
      side({ seoTitle: 'Дрель ударная 800 Вт', aiLockedFields: ['seoTitle'] }),
    );
    expect(state).toMatchObject({
      seoTitle: 'Дрель ударная 800 Вт',
      aiLockedFields: ['seoTitle'],
    });
    expect(state.contentUpdatedAt).toBeInstanceOf(Date);
  });

  it('keeps the target’s own locked value', () => {
    const state = mergedState(
      side({ name: 'Наша', lockedFields: ['name'] }),
      side({ name: 'Их', aiLockedFields: ['name'] }),
    );
    expect(state).not.toHaveProperty('name');
    expect(state).not.toHaveProperty('contentUpdatedAt');
  });

  it('leaves the duplicate’s slug lock behind with its URL', () => {
    const state = mergedState(side(), side({ lockedFields: ['slug'] }));
    expect(state.lockedFields).toEqual([]);
  });

  it('keeps a size line set on the duplicate', () => {
    expect(
      mergedState(
        side(),
        side({ variantLine: 'bur-sds', variantLabel: '8 мм' }),
      ),
    ).toMatchObject({ variantLine: 'bur-sds', variantLabel: '8 мм' });
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
