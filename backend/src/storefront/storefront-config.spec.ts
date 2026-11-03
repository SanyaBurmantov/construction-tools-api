import {
  KEY_HEADER_CATEGORIES,
  KEY_POPULAR_PRODUCTS,
  MAX_HEADER_CATEGORIES,
  normalizeHeaderCategories,
  normalizeProductIds,
  parseStoredConfig,
} from './storefront-config';

const A = '846eaddd-c36d-45c5-9fdc-9b1fbb430f71';
const B = '31a7b01b-a7d2-468a-9896-12e6000799c4';

describe('normalizeHeaderCategories', () => {
  it('keeps the order, trims labels, drops duplicates and defaults the flags', () => {
    expect(
      normalizeHeaderCategories([
        { categoryId: A, label: '  Крепёж  ' },
        { categoryId: B, highlight: true, label: '' },
        { categoryId: A, label: 'дубль' },
      ]),
    ).toEqual([
      { categoryId: A, label: 'Крепёж', highlight: false },
      { categoryId: B, label: null, highlight: true },
    ]);
  });

  it('caps a label at 40 characters', () => {
    const [pick] = normalizeHeaderCategories([
      { categoryId: A, label: 'x'.repeat(100) },
    ]);
    expect(pick.label).toHaveLength(40);
  });

  it('rejects a malformed body, a bad id and an over-long list', () => {
    expect(() => normalizeHeaderCategories('nope')).toThrow();
    expect(() =>
      normalizeHeaderCategories([{ categoryId: '1; drop table' }]),
    ).toThrow();
    expect(() =>
      normalizeHeaderCategories(
        Array.from({ length: MAX_HEADER_CATEGORIES + 1 }, () => ({
          categoryId: A,
        })),
      ),
    ).toThrow();
  });
});

describe('normalizeProductIds', () => {
  it('keeps uuids in order without repeats and rejects anything else', () => {
    expect(normalizeProductIds([A, B, A])).toEqual([A, B]);
    expect(() => normalizeProductIds([A, 42])).toThrow();
    expect(() => normalizeProductIds({})).toThrow();
  });
});

describe('parseStoredConfig', () => {
  it('reads what was stored and treats broken JSON as not curated', () => {
    expect(
      parseStoredConfig(
        new Map([
          [KEY_HEADER_CATEGORIES, JSON.stringify([{ categoryId: A }])],
          [KEY_POPULAR_PRODUCTS, '{broken'],
        ]),
      ),
    ).toEqual({
      headerCategories: [{ categoryId: A, label: null, highlight: false }],
      popularProducts: [],
    });
    expect(parseStoredConfig(new Map())).toEqual({
      headerCategories: [],
      popularProducts: [],
    });
  });
});
