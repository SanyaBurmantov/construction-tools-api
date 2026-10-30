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
    expect(similarityScore(product('a', 'Новый'), product('b', 'Новый'))).toBe(
      0,
    );
  });

  // 68% of the production catalogue had no kind and so no «Похожие».
  it('falls back to the first noun of the name', () => {
    expect(
      productKind(product('a', 'Анкер забиваемый М10х12х40 мм (4 шт) STARFIX')),
    ).toBe('анкер');
    expect(productKind(product('a', 'Гайка М24 шестигр., цинк, DIN 934'))).toBe(
      productKind(product('b', 'Гайки М6 барашковые')),
    );
    expect(productKind(product('a', 'Строительный фен 2000 Вт'))).toBe('фен');
    expect(productKind(product('a', 'Набор для ремонта шин'))).toBe(
      'набор ремонт',
    );
    expect(
      similarityScore(
        product('a', 'Анкер клиновой М10х120 мм'),
        product('b', 'Болт М10х120 мм'),
      ),
    ).toBe(0);
    expect(
      similarityScore(
        product('a', 'Анкер клиновой М10х120 мм'),
        product('b', 'Анкер рамный 10х112 мм'),
      ),
    ).toBeGreaterThan(0);
  });
});
