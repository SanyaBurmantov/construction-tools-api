import { ProductStatus } from '@prisma/client';
import { aiMayMoveProductUrl, slugFromName } from './product-slug';

describe('aiMayMoveProductUrl', () => {
  it('moves only a draft — an address that was never public', () => {
    expect(aiMayMoveProductUrl({ status: ProductStatus.DRAFT })).toBe(true);
    for (const status of [
      ProductStatus.PUBLISHED,
      ProductStatus.HIDDEN,
      ProductStatus.ARCHIVED,
    ]) {
      expect(aiMayMoveProductUrl({ status })).toBe(false);
    }
  });

  it('refuses when the status was not read', () => {
    expect(aiMayMoveProductUrl({})).toBe(false);
  });

  it('moves a draft once: a slug that is already ours stays', () => {
    const draft = { status: ProductStatus.DRAFT };
    expect(aiMayMoveProductUrl({ ...draft, aiLockedFields: ['slug'] })).toBe(
      false,
    );
    expect(aiMayMoveProductUrl({ ...draft, lockedFields: ['slug'] })).toBe(
      false,
    );
    expect(aiMayMoveProductUrl({ ...draft, aiLockedFields: ['name'] })).toBe(
      true,
    );
  });
});

describe('slugFromName', () => {
  it('cuts a long name at a word boundary', () => {
    const slug = slugFromName('Перфоратор аккумуляторный '.repeat(10));
    expect(slug.length).toBeLessThanOrEqual(90);
    expect(slug.endsWith('-')).toBe(false);
  });
});
