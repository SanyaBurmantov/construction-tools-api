import { productKind, similarityScore } from './similarity';

const product = (id: string, name: string, value = '18', price = 100) => ({
  id,
  name,
  categoryId: 'c',
  brandId: 'b',
  brand: { name: 'Maker' },
  priceValue: price,
  priceCurrency: 'BYN',
  productSpecs: [
    {
      valueNorm: value,
      specification: { canonicalKey: 'voltage~v', name: 'Напряжение, В' },
    },
  ],
});

describe('similarity ranking', () => {
  it('recognizes the product noun, not a shared adjective or brand', () => {
    expect(productKind(product('a', 'Maker Аккумуляторная дрель VX100'))).toBe(
      'дрель',
    );
    expect(productKind(product('b', 'Maker Аккумуляторная пила ZX100'))).toBe(
      'пила',
    );
    expect(
      similarityScore(
        product('a', 'Аккумуляторная дрель'),
        product('b', 'Аккумуляторная пила'),
      ),
    ).toBe(0);
  });

  it('does not treat a set as an individual tool or unrelated sets as similar', () => {
    expect(
      similarityScore(product('a', 'Набор ключей'), product('b', 'Ключ')),
    ).toBe(0);
    expect(
      similarityScore(
        product('a', 'Набор ключей'),
        product('b', 'Набор сверл'),
      ),
    ).toBe(0);
  });

  it('prefers matching normalized specifications and comparable price', () => {
    const anchor = product('a', 'Дрель Maker VX100');
    expect(
      similarityScore(anchor, product('b', 'Дрель Maker VX200', '18', 110)),
    ).toBeGreaterThan(
      similarityScore(anchor, product('c', 'Дрель Maker VX300', '12', 500)),
    );
  });

  it('rejects self, different categories and unrecognized kinds', () => {
    const anchor = product('a', 'Дрель');
    expect(similarityScore(anchor, anchor)).toBe(0);
    expect(
      similarityScore(anchor, {
        ...product('b', 'Дрель'),
        categoryId: 'other',
      }),
    ).toBe(0);
    expect(
      similarityScore(product('a', 'Прочее'), product('b', 'Прочее')),
    ).toBe(0);
  });
});
