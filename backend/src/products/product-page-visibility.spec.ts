import {
  UNAVAILABLE_PAGE_DAYS,
  productPageState,
} from './product-page-visibility';

const now = new Date('2026-11-06T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe('productPageState', () => {
  it('keeps a product on sale', () => {
    expect(
      productPageState(
        { status: 'PUBLISHED', statusSource: 'SYSTEM' },
        daysAgo(1),
        now,
      ),
    ).toBe('on-sale');
  });

  it('shows a product the system hid as unavailable while it is recent', () => {
    expect(
      productPageState(
        { status: 'HIDDEN', statusSource: 'SYSTEM' },
        daysAgo(3),
        now,
      ),
    ).toBe('unavailable');
    expect(
      productPageState(
        { status: 'HIDDEN', statusSource: 'SYSTEM' },
        daysAgo(UNAVAILABLE_PAGE_DAYS + 1),
        now,
      ),
    ).toBe('gone');
  });

  it('never shows what an admin hid or archived, a draft, or a product without offers', () => {
    for (const product of [
      { status: 'HIDDEN', statusSource: 'ADMIN' },
      { status: 'ARCHIVED', statusSource: 'ADMIN' },
      { status: 'ARCHIVED', statusSource: 'SYSTEM' },
      { status: 'DRAFT', statusSource: 'SYSTEM' },
    ] as const) {
      expect(productPageState(product, daysAgo(1), now)).toBe('gone');
    }
    expect(
      productPageState({ status: 'HIDDEN', statusSource: 'SYSTEM' }, null, now),
    ).toBe('gone');
  });
});
