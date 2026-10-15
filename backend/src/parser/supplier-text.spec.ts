import {
  cleanProductTexts,
  sanitizeSupplierText,
  sanitizeSupplierTitle,
  truncateAtWord,
} from './supplier-text';

// Verbatim from production rows imported from dukon.by.
const DUKON_META =
  'Купить Ключ рожковый 23x26 мм KING TONY 19002326 в Минске с гарантией и доставкой. Лучшие цены от ведущих производителей ➢ Звоните, наши специалисты ответят на все интересующие вопросы ☎ +375 (29) 668-00-11';
const DUKON_META_DOTTED =
  'Купить TDB045 Сверло спиральное по металлу HSS, d4.5 мм в Минске с гарантией и доставкой. Лучшие цены от ведущих производителей ➢ Звоните, наши специалисты ответят на все интересующие вопросы ☎ +375 (29) 668-00-11';
const DUKON_META_SHORT =
  'Набор инструментов JONNESWAY S04H52478S купить в Минске с гарантией и доставкой.';
const DUKON_FULL =
  'Назначение: служит для затягивания и отвинчивания болтовых соединений вручную. Особенности: Прочность. Долговечность. Изготовлен из хром-ванадиевого сплава стали. Технические характеристики ключа KING TONY 19002326: Размер min: 23 мм Размер max: 26 мм Вес нетто: 0,281 кг';

describe('sanitizeSupplierText', () => {
  it('drops the whole dukon meta template, phone included', () => {
    expect(sanitizeSupplierText(DUKON_META)).toBe('');
    expect(sanitizeSupplierText(DUKON_META_DOTTED)).toBe('');
    expect(sanitizeSupplierText(DUKON_META_SHORT)).toBe('');
  });

  it('keeps technical text that only looks similar', () => {
    const texts = [
      DUKON_FULL,
      'Соответствие стандарту DIN 965 гарантирует качество и точность размеров.',
      'Шлифовальный диск 125мм гарантирует высокую скорость удаления материала.',
      'Произведено на заводе в Минске. Гарантия - 1 год.',
      'Описание: Код товара 37512 Производитель Стандарт Страна производства - КИТАЙ',
      'Штрихкод 3751234567890, длина 375 мм.',
      'Строка один.\nСтрока два с переносом.',
    ];
    for (const text of texts) expect(sanitizeSupplierText(text)).toBe(text);
  });

  it('keeps the technical part when boilerplate is appended to it', () => {
    expect(
      sanitizeSupplierText(
        'Ключ из хром-ванадиевой стали. Лучшие цены от ведущих производителей ➢ Звоните, наши специалисты ответят на все интересующие вопросы ☎ +375 (29) 668-00-11',
      ),
    ).toBe('Ключ из хром-ванадиевой стали.');
  });

  it('removes a bare phone number but keeps the sentence around it', () => {
    expect(
      sanitizeSupplierText(
        'Сверло HSS d4.5 мм. Консультация по тел.: +375 29 668-00-11, ежедневно.',
      ),
    ).toBe('Сверло HSS d4.5 мм. Консультация по, ежедневно.');
    expect(sanitizeSupplierText('Справки 8 (029) 668-00-11')).toBe('Справки');
  });

  it('removes a «купить … в Минске» sentence from the middle of a description', () => {
    expect(
      sanitizeSupplierText(
        'Перфоратор для сверления бетона. Купить перфоратор в Минске можно у нас. Мощность 800 Вт.',
      ),
    ).toBe('Перфоратор для сверления бетона. Мощность 800 Вт.');
  });

  it('handles empty input', () => {
    expect(sanitizeSupplierText(null)).toBe('');
    expect(sanitizeSupplierText(undefined)).toBe('');
    expect(sanitizeSupplierText('')).toBe('');
  });
});

describe('sanitizeSupplierTitle', () => {
  it('strips the «купить в Минске» tail, typo included', () => {
    expect(
      sanitizeSupplierTitle(
        'Ключ рожковый 23x26 мм KING TONY 19002326 купить в Минске',
      ),
    ).toBe('Ключ рожковый 23x26 мм KING TONY 19002326');
    expect(
      sanitizeSupplierTitle(
        'Сверло спиральное по металлу Thorvik TDB045 купить в Мниске',
      ),
    ).toBe('Сверло спиральное по металлу Thorvik TDB045');
  });

  it('leaves an ordinary title alone', () => {
    expect(sanitizeSupplierTitle('Ключ рожковый 23x26 мм')).toBe(
      'Ключ рожковый 23x26 мм',
    );
  });
});

describe('truncateAtWord', () => {
  it('cuts on a word boundary with an ellipsis', () => {
    expect(truncateAtWord('Его удобная форма позволяет работать', 25)).toBe(
      'Его удобная форма…',
    );
    expect(truncateAtWord('короткий', 25)).toBe('короткий');
  });
});

describe('cleanProductTexts', () => {
  it('returns only changed fields, with sensible fallbacks', () => {
    expect(
      cleanProductTexts({
        name: 'Ключ рожковый 23x26 мм KING TONY 19002326',
        descriptionShort: DUKON_META,
        descriptionFull: DUKON_FULL,
        seoTitle: 'Ключ рожковый 23x26 мм KING TONY 19002326 купить в Минске',
        seoDescription: DUKON_META,
      }),
    ).toEqual({
      descriptionShort: truncateAtWord(DUKON_FULL, 240),
      seoDescription: truncateAtWord(DUKON_FULL, 240),
      seoTitle: 'Ключ рожковый 23x26 мм KING TONY 19002326',
    });
  });

  it('falls back to the name when there is no other text', () => {
    expect(
      cleanProductTexts({
        name: 'Сверло',
        descriptionShort: DUKON_META_DOTTED,
        seoDescription: DUKON_META_DOTTED,
      }),
    ).toEqual({ descriptionShort: null, seoDescription: 'Сверло' });
  });

  it('is a no-op for clean text and absent fields', () => {
    expect(
      cleanProductTexts({ name: 'Ключ', descriptionFull: DUKON_FULL }),
    ).toEqual({});
  });
});
