import {
  stripVarDump,
  cleanProductTexts,
  collapseRepeatedText,
  MIN_REPEAT_BLOCK,
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
      'Код товара 37512 Производитель Стандарт Страна производства - КИТАЙ',
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

describe('tab headers', () => {
  // Real production starts of tools.by and dukon descriptions.
  it.each([
    [
      'Файлы BULL Электроинструмент Описание: BULL DG 2240 - это идеальный инструмент.',
      'BULL DG 2240 - это идеальный инструмент.',
    ],
    [
      'Файлы РЕДИУС Газовое оборудование Описание: Малогабаритный ацетиленовый редуктор.',
      'Малогабаритный ацетиленовый редуктор.',
    ],
    ['Описание: 10 A, 250 V, IP 20', '10 A, 250 V, IP 20'],
    [
      'Описание Рама верстака выполнена из стали.',
      'Рама верстака выполнена из стали.',
    ],
    [
      'ОписаниеРама верстака выполнена из стали.',
      'Рама верстака выполнена из стали.',
    ],
  ])('strips the supplier tab labels from %s', (input, expected) => {
    expect(sanitizeSupplierText(input)).toBe(expected);
  });

  it('strips a repeated label and one glued to the text', () => {
    expect(
      sanitizeSupplierText(
        'Файлы X Y Описание Описание: Алмазный отрезной круг.',
      ),
    ).toBe('Алмазный отрезной круг.');
    expect(
      sanitizeSupplierText('Описаниевыпускаются по ГОСТ Р 58863-2020.'),
    ).toBe('выпускаются по ГОСТ Р 58863-2020.');
    expect(sanitizeSupplierText('Описанием служит паспорт изделия.')).toBe(
      'Описанием служит паспорт изделия.',
    );
  });

  it('empties a description that is nothing but tab labels', () => {
    expect(sanitizeSupplierText('Файлы STARTUL Ручной инструмент')).toBe('');
    expect(
      sanitizeSupplierText(
        'Файлы PRO STARTUL Автомобильный слесарный инструмент',
      ),
    ).toBe('');
  });

  it('keeps a description that merely starts with the word', () => {
    expect(sanitizeSupplierText('Описание товара уточняйте у менеджера.')).toBe(
      'Описание товара уточняйте у менеджера.',
    );
    expect(sanitizeSupplierText('Файлы cookie не используются.')).toBe(
      'Файлы cookie не используются.',
    );
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

describe('stripVarDump', () => {
  // The shape dukon.by prints (2026-11-06), shortened; string lengths are
  // PHP's byte counts, Cyrillic is two bytes a letter.
  const dump =
    'Подробная информация array(2) { [0]=> array(3) { ["ID"]=> int(35566) ' +
    '["NAME"]=> string(12) "Краска" ["CODE"]=> string(7) "a}b{c"d" } ' +
    '[1]=> array(1) { ["ACTIVE"]=> string(1) "Y" } } ';

  it('cuts the dump and keeps the text after it', () => {
    expect(stripVarDump(`${dump}Краска в аэрозоле, чёрная матовая.`)).toBe(
      'Краска в аэрозоле, чёрная матовая.',
    );
  });

  it('keeps text before the dump too', () => {
    expect(stripVarDump(`Эмаль 3 л. ${dump}Сохнет за 20 минут.`)).toBe(
      'Эмаль 3 л. Сохнет за 20 минут.',
    );
  });

  it('goes through sanitizeSupplierText for every parser', () => {
    expect(sanitizeSupplierText(`${dump}Описание: Лак акриловый.`)).toBe(
      'Лак акриловый.',
    );
  });

  it('leaves ordinary text alone, arrows included', () => {
    const text = 'Переходник 1/2" => 3/8", сталь CrV.';
    expect(stripVarDump(text)).toBe(text);
  });

  it('drops a dump cut short, and the short text falls back to the full one', () => {
    const cut = dump.slice(0, 90);
    expect(stripVarDump(cut)).toBe('');
    expect(
      cleanProductTexts({
        name: 'Краска',
        descriptionShort: cut,
        descriptionFull: `${dump}Краска в аэрозоле, чёрная матовая.`,
      }),
    ).toEqual({
      descriptionShort: 'Краска в аэрозоле, чёрная матовая.',
      descriptionFull: 'Краска в аэрозоле, чёрная матовая.',
    });
  });

  it('cuts an unbalanced dump up to its last brace', () => {
    expect(
      stripVarDump('array(1) { ["A"]=> array(1) { ["B"]=> int(1) } Текст'),
    ).toBe('Текст');
  });
});

// Verbatim from production (gost.by/api/products/…, 2026-11-12): one copy of
// the Complex Miracle text that dukon.by's four trade offers repeated.
const MIRACLE =
  'Бесконтактный автошампунь с пеной зеленого цвета. Преимущества: Образует цветную стойкую активную пену, эффективно удаляющую загрязнения Эффективно удаляет засохшую грязь и следы насекомых, растворяет и смывает масляные загрязнения Позволяет получить чистую блестящую поверхность без разводов и белесого налета Не окрашивает поверхность и не оказывает негативного воздействия на пластик, резину и ЛКП автомобиля Свойства: Состав: деионизированная вода (30% и более), анионные поверхностно-активные вещества (более 5 %, но менее 15 %), неионогенные поверхностно-активные вещества (менее 5 %), комплексообразователи (более 15 %, но менее 30 %), гидроксид натрия (менее 5%), функциональные добавки, краситель. Срок годности: 3 года с даты изготовления Страна производитель: Россия Применение: Пеногенератор: 750мл на 50л. Пенокомплект: 150мл на 1л. Дозатрон 1 – 2%. Время выдержки 1-2 мин. Рекомендации: Хранить в недоступном для детей месте. Не наносить на горячую поверхность! Не допускать высыхания цветной пены на поверхности! Избегать длительного контакта с кожей. В случае попадания в глаза немедленно промыть большим количеством проточной воды. При необходимости обратиться к врачу.';
// 421 characters, 32 times on the СМ benches.
const BENCH =
  'Скамьи для раздевалок, гардеробных и подсобных помещений изготавливаются в общепромышленном и антистатическом исполнении. Длина скамьи: 1000, 1200, 1500, 1800, 2000 мм. Ширина скамьи: 400 мм. Современный дизайн, прочная, усиленная конструкция. Представлена в трёх основных цветах каркасов и кромок. Скамья регулируется по высоте сиденья от 455 мм до 735 мм от уровня пола. Максимально распределенная нагрузка – до 400 кг.';

describe('collapseRepeatedText', () => {
  it('keeps one copy of a text repeated back to back', () => {
    expect(collapseRepeatedText(Array(4).fill(MIRACLE).join(' '))).toBe(
      MIRACLE,
    );
    expect(collapseRepeatedText(Array(32).fill(BENCH).join(' '))).toBe(BENCH);
    expect(collapseRepeatedText(`${BENCH} ${BENCH}`)).toBe(BENCH);
  });

  it('ignores whitespace differences between the copies', () => {
    const glued = `${BENCH}${BENCH}`;
    expect(collapseRepeatedText(glued)).toBe(BENCH);
    const spaced = `${BENCH}\n\n${BENCH.replace(/ /g, '  ')}\n`;
    expect(collapseRepeatedText(spaced)).toBe(BENCH);
  });

  it('drops a paragraph equal to the one before it', () => {
    const intro = 'Шлифмашина угловая BULL WS 1210.';
    expect(
      collapseRepeatedText(
        `${intro}\n${BENCH}\n${BENCH}\nГарантия 12 месяцев.`,
      ),
    ).toBe(`${intro}\n${BENCH}\nГарантия 12 месяцев.`);
  });

  it('leaves short repeats, list rows and spec-table rows alone', () => {
    const texts = [
      'Да Да',
      '— — —',
      'Ключ рожковый 10x12. Ключ рожковый 10x12.',
      'Материал: сталь\nМатериал: сталь\nПокрытие: —\nПокрытие: —',
      '■ ■ Инструмент оснащен защитой от перегрузки.',
      'Вес 180 600 Ход площадки, мм 40 80 Напряжение питания, В 380 380',
      // A block just under the minimum, twice.
      `${'а'.repeat(MIN_REPEAT_BLOCK - 1)} ${'а'.repeat(MIN_REPEAT_BLOCK - 1)}`,
    ];
    for (const text of texts) expect(collapseRepeatedText(text)).toBe(text);
  });

  it('leaves a text that only partly repeats itself alone', () => {
    // Suppliers restate a sentence further down (JOHN BEAN V2260), and two
    // offers can differ in a word — neither is a copy to drop.
    const texts = [
      `${BENCH} Цвет каркаса: серый. ${BENCH}`,
      `${BENCH} ${BENCH} Цвет каркаса: серый.`,
      `${BENCH} ${BENCH.replace('400 кг', '300 кг')}`,
      `${MIRACLE} ${MIRACLE.replace('зеленого', 'розового')}`,
    ];
    for (const text of texts) expect(collapseRepeatedText(text)).toBe(text);
  });

  it('runs inside sanitizeSupplierText, before and after the boilerplate goes', () => {
    expect(sanitizeSupplierText(Array(3).fill(MIRACLE).join(' '))).toBe(
      MIRACLE,
    );
    expect(
      sanitizeSupplierText(
        `Описание: ${BENCH} ${BENCH} Звоните ☎ +375 (29) 668-00-11`,
      ),
    ).toBe(BENCH);
  });

  it('re-cuts the short text and its SEO copy from the collapsed full one', () => {
    // The parsers cut the short text from the full one. A block over 240
    // characters gives the same cut; a shorter one held its second copy.
    const repeated = `${BENCH} ${BENCH}`;
    const short = truncateAtWord(repeated, 240);
    expect(
      cleanProductTexts({
        name: 'Скамья СМ-1000',
        descriptionFull: repeated,
        descriptionShort: short,
        seoDescription: short,
      }),
    ).toEqual({ descriptionFull: BENCH });
    // A short text of a block under 240 characters held the start of the
    // second copy.
    const block = BENCH.slice(0, 200);
    const twice = `${block} ${block}`;
    expect(
      cleanProductTexts({
        name: 'Скамья',
        descriptionFull: twice,
        descriptionShort: truncateAtWord(twice, 240),
        seoDescription: truncateAtWord(twice, 240),
      }),
    ).toEqual({
      descriptionFull: block,
      descriptionShort: block,
      seoDescription: block,
    });
  });

  it('leaves a short text of its own alone', () => {
    expect(
      cleanProductTexts({
        name: 'Скамья',
        descriptionFull: `${BENCH} ${BENCH}`,
        descriptionShort: 'Скамья для раздевалок.',
        seoDescription: 'Скамья для раздевалок.',
      }),
    ).toEqual({ descriptionFull: BENCH });
  });
});
