import { productKind, productKindStem, similarityScore } from './similarity';

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

  // «Круг отрезной 100 мм» for a mini grinder is not like a 230 mm one.
  it('prefers the same size when the names otherwise read alike', () => {
    const disc = product('a', 'Круг отрезной 100 мм по металлу');
    expect(
      similarityScore(disc, product('b', 'Круг отрезной 100 мм по камню')),
    ).toBeGreaterThan(
      similarityScore(disc, product('c', 'Круг отрезной 230 мм по металлу')),
    );
  });

  // The same kind filed in another branch may join, below the own category.
  it('scores another category only when asked to, and lower', () => {
    const tag = product('a', 'Бирка для ключей пластиковая');
    const elsewhere = {
      ...product('b', 'Бирка для ключей пластиковая'),
      categoryId: 'other',
    };
    const here = product('c', 'Бирка для ключей пластиковая');
    expect(similarityScore(tag, elsewhere)).toBe(0);
    expect(
      similarityScore(tag, elsewhere, { anyCategory: true }),
    ).toBeGreaterThan(0);
    expect(similarityScore(tag, here)).toBeGreaterThan(
      similarityScore(tag, elsewhere, { anyCategory: true }),
    );
    // A window handle is never «like» a key tag, wherever it is filed.
    expect(
      similarityScore(
        tag,
        { ...product('d', 'Ручка для пластиковых окон'), categoryId: 'other' },
        { anyCategory: true },
      ),
    ).toBe(0);
  });

  it('gives the stem a search elsewhere looks for', () => {
    expect(productKindStem(product('a', 'Бирка для ключей АЛЛЮР'))).toBe(
      'бирк',
    );
    expect(productKindStem(product('a', 'Биты PH2 1/4'))).toBe('бит');
    expect(productKindStem(product('a', '(1/2", 24 мм, L=38 мм)'))).toBe('');
  });

  // Reported 2026-11-04: an adapter for a respirator prefilter showed
  // adapters for bits and compressometers — the same word, another purpose.
  it("takes another category's item of the same kind only when they share a detail", () => {
    const adapter = product(
      'a',
      'Адаптер для предфильтра 6101 Jeta Safety (уп/2шт)',
    );
    const elsewhere = (id: string, name: string) => ({
      ...product(id, name),
      categoryId: 'other',
    });
    expect(
      similarityScore(
        adapter,
        elsewhere(
          'b',
          'Адаптер для противоаэрозольного фильтра Jeta Safety JETA PRO 6101',
        ),
        { anyCategory: true },
      ),
    ).toBeGreaterThan(0);
    expect(
      similarityScore(adapter, elsewhere('c', 'Адаптер для бит 1/4"'), {
        anyCategory: true,
      }),
    ).toBe(0);
    expect(
      similarityScore(
        adapter,
        elsewhere('d', 'Адаптер для компрессометра гибкий JTC-4908'),
        { anyCategory: true },
      ),
    ).toBe(0);
    // Word forms meet: «барашковые» / «барашковая».
    expect(
      similarityScore(
        product('e', 'Гайки барашковые, 150пр. (М3, М4, М5)'),
        elsewhere('f', 'Гайка М8 барашковая, цинк, DIN 315'),
        { anyCategory: true },
      ),
    ).toBeGreaterThan(0);
  });
});
