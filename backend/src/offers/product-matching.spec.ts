import {
  ProductIdentity,
  buildMatchKeys,
  compareProducts,
  isAutoMergeable,
  nameSimilarity,
  normalizeBarcode,
  normalizeCode,
  normalizeName,
} from './product-matching';

function product(overrides: Partial<ProductIdentity> = {}): ProductIdentity {
  return {
    id: 'a',
    name: 'Дрель ударная Makita HP1630 710 Вт',
    brandName: 'Makita',
    sku: 'HP1630',
    barcode: '0088381079990',
    model: 'HP1630',
    ...overrides,
  };
}

describe('normalizeCode', () => {
  it('strips punctuation and case so supplier spellings converge', () => {
    expect(normalizeCode('DF-333 D')).toBe('DF333D');
    expect(normalizeCode('df333/d')).toBe('DF333D');
    expect(normalizeCode('  DF333D  ')).toBe('DF333D');
  });

  // "1" or "AB" would match half the catalogue.
  it('rejects codes too short to identify anything', () => {
    expect(normalizeCode('1')).toBeNull();
    expect(normalizeCode('AB')).toBeNull();
    expect(normalizeCode('')).toBeNull();
    expect(normalizeCode(null)).toBeNull();
  });
});

describe('normalizeBarcode', () => {
  it('keeps digits of a plausible EAN/UPC length', () => {
    expect(normalizeBarcode('0088381079990')).toBe('0088381079990');
    expect(normalizeBarcode('4 620013 123456')).toBe('4620013123456');
  });

  it('rejects lengths that are not barcodes', () => {
    expect(normalizeBarcode('1234')).toBeNull();
    expect(normalizeBarcode('123456789012345678')).toBeNull();
  });

  // Supplier feeds are full of these placeholders.
  it('rejects repeated-digit placeholders', () => {
    expect(normalizeBarcode('0000000000000')).toBeNull();
    expect(normalizeBarcode('1111111111')).toBeNull();
  });
});

describe('normalizeName', () => {
  it('ignores word order, case and punctuation', () => {
    expect(normalizeName('Дрель ударная Makita')).toBe(
      normalizeName('makita, УДАРНАЯ дрель'),
    );
  });

  it('drops marketing noise', () => {
    expect(normalizeName('Дрель АКЦИЯ новинка')).toBe('дрель');
  });

  it('treats ё and е as the same letter', () => {
    expect(normalizeName('Свёрло')).toBe(normalizeName('Сверло'));
  });
});

describe('nameSimilarity', () => {
  it('scores identical names as 1', () => {
    expect(nameSimilarity('Дрель ударная', 'ударная Дрель')).toBe(1);
  });

  it('scores unrelated names near zero', () => {
    expect(nameSimilarity('Дрель ударная', 'Перчатки садовые')).toBeLessThan(
      0.2,
    );
  });
});

describe('buildMatchKeys', () => {
  it('scopes the sku key by brand', () => {
    const keys = buildMatchKeys(product());
    expect(keys.matchSku).toBe('makita:HP1630');
  });

  // Otherwise "SKU 1000" from two manufacturers would collide.
  it('produces no sku key without a brand', () => {
    expect(buildMatchKeys(product({ brandName: null })).matchSku).toBeNull();
  });

  it('produces no barcode key from a placeholder', () => {
    expect(
      buildMatchKeys(product({ barcode: '0000000000000' })).matchBarcode,
    ).toBeNull();
  });
});

describe('compareProducts', () => {
  it('never matches a product with itself', () => {
    expect(compareProducts(product(), product())).toBeNull();
  });

  it('treats an equal barcode as an exact match', () => {
    const a = product({ id: 'a', name: 'Дрель Makita', sku: 'X1' });
    const b = product({ id: 'b', name: 'Совсем другое название', sku: 'Y2' });

    const result = compareProducts(a, b);
    expect(result).toMatchObject({ signal: 'barcode', confidence: 'exact' });
    expect(isAutoMergeable(result!)).toBe(true);
  });

  it('treats brand + sku as a strong match worth auto-merging', () => {
    const a = product({ id: 'a', barcode: null, sku: 'HP-1630' });
    const b = product({
      id: 'b',
      barcode: null,
      sku: 'hp1630',
      name: 'Makita HP 1630',
    });

    const result = compareProducts(a, b);
    expect(result).toMatchObject({ signal: 'sku', confidence: 'strong' });
    expect(isAutoMergeable(result!)).toBe(true);
  });

  // Model numbers get reused across variants, so this only ever suggests.
  it('treats brand + model as a suggestion, not an auto-merge', () => {
    const a = product({ id: 'a', barcode: null, sku: null });
    const b = product({
      id: 'b',
      barcode: null,
      sku: null,
      name: 'Другое имя',
    });

    const result = compareProducts(a, b);
    expect(result).toMatchObject({ signal: 'model', confidence: 'likely' });
    expect(isAutoMergeable(result!)).toBe(false);
  });

  it('suggests a weak match on a very similar name alone', () => {
    const a = product({
      id: 'a',
      barcode: null,
      sku: null,
      model: null,
      brandName: null,
    });
    const b = product({
      id: 'b',
      barcode: null,
      sku: null,
      model: null,
      brandName: null,
      name: 'Ударная дрель Makita HP1630 Вт 710',
    });

    const result = compareProducts(a, b);
    expect(result?.signal).toBe('name');
    expect(isAutoMergeable(result!)).toBe(false);
  });

  // The dangerous false positive: same описание, different manufacturer.
  it('refuses a name match across different brands', () => {
    const a = product({
      id: 'a',
      barcode: null,
      sku: null,
      model: null,
      brandName: 'Makita',
      name: 'Дрель ударная 710 Вт',
    });
    const b = product({
      id: 'b',
      barcode: null,
      sku: null,
      model: null,
      brandName: 'Bosch',
      name: 'Дрель ударная 710 Вт',
    });

    expect(compareProducts(a, b)).toBeNull();
  });

  it('returns nothing when the products share no usable signal', () => {
    const a = product({
      id: 'a',
      barcode: null,
      sku: null,
      model: null,
      brandName: null,
    });
    const b = product({
      id: 'b',
      barcode: null,
      sku: null,
      model: null,
      brandName: null,
      name: 'Перчатки садовые хлопковые',
    });

    expect(compareProducts(a, b)).toBeNull();
  });
});
