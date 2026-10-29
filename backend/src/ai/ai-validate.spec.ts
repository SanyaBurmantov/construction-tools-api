import { fixHomoglyphs, numbersIn, validateAnswer } from './ai-validate';

/** The Bosch card from the 2026-10-29 DeepSeek trial, as the model saw it. */
const BOSCH = {
  entity: 'PRODUCT' as const,
  oldName: 'Аккум. перфоратор BOSCH GBH 18V-45 C в чем.',
  brand: 'Bosch',
  source: [
    'Аккум. перфоратор BOSCH GBH 18V-45 C в чем.',
    'Bosch',
    'Электроинструмент / Аккумуляторный инструмент / Аккумуляторные перфораторы',
    '611913120',
    'Патрон: SDS-Max; Режимов работы: 2; Диаметр сверления в бетоне, мм: 45;',
    'Страна: Германия; Напряжение, В: 18; Энергия удара, Дж: 12.5;',
    'Число оборотов, об/мин: 0-305; Тип двигателя: Бесщеточный;',
    'Частота ударов, уд/мин: 0-2760; Вес, кг: 8; Габариты упаковки: 44 x 35 x 24',
    'Особенности: Bluetooth Low Energy - чип BT ... BITURBO ... ProCore 18V 12,0 Ач.',
    'Контроль отдачи ... плавного пуска EPC ASC ... Работает на расстоянии до 30 м.',
    'Комплектация: + Перфоратор + Боковая рукоятка + Тюбик смазки в патрон + Кейс.',
  ].join('\n'),
};

describe('numbersIn', () => {
  it('normalises decimals and keeps both readings of a spaced group', () => {
    const found = numbersIn('12,5 Дж, 12.50, 1 200 об/мин, 0–2760, 08');
    for (const n of ['12.5', '1200', '1', '200', '0', '2760', '8'])
      expect(found.has(n)).toBe(true);
  });
});

describe('fixHomoglyphs', () => {
  it('turns Latin look-alikes inside Cyrillic words back', () => {
    expect(fixHomoglyphs('Kлeщи для xoмутoв ШPУCa TOPTUL')).toBe(
      'Клещи для хомутов ШРУСа TOPTUL',
    );
  });
});

describe('validateAnswer', () => {
  it('passes the good Bosch rewrite', () => {
    expect(
      validateAnswer(BOSCH, {
        name: 'Аккумуляторный перфоратор Bosch GBH 18V-45 C SDS-Max, 18 В, 12,5 Дж, в кейсе',
        descriptionShort:
          'Аккумуляторный перфоратор SDS-Max с бесщеточным двигателем BITURBO и энергией удара 12,5 Дж. Для работ по бетону, сверление до 45 мм.',
        seoTitle: 'Аккумуляторный перфоратор Bosch GBH 18V-45 C SDS-Max',
        seoDescription:
          'Аккумуляторный перфоратор Bosch GBH 18V-45 C SDS-Max, 18 В, 12,5 Дж, до 45 мм в бетоне. Доставка по Беларуси, оплата по безналу для организаций.',
      }),
    ).toEqual({});
  });

  it('rejects a technology name the data does not have', () => {
    const result = validateAnswer(BOSCH, {
      descriptionFull:
        'Инструмент оснащен системой контроля отдачи KickBack Control, снижающей риск внезапных реакций при заклинивании бура. '.repeat(
          2,
        ),
    });
    expect(result.descriptionFull).toMatch(/KickBack/);
  });

  it('rejects an invented number', () => {
    const result = validateAnswer(BOSCH, {
      descriptionShort:
        'Аккумуляторный перфоратор весом 6,5 кг для работ по бетону и кирпичу на объектах.',
    });
    expect(result.descriptionShort).toBe('число 6.5 не из данных товара');
  });

  it('rejects claims the source does not back', () => {
    expect(
      validateAnswer(BOSCH, {
        descriptionShort:
          'Лучший перфоратор для бетона, всегда в наличии на складе в нашем магазине.',
      }).descriptionShort,
    ).toMatch(/утверждение не из данных/);
  });

  it('allows a country the specs name', () => {
    expect(
      validateAnswer(BOSCH, {
        descriptionShort:
          'Аккумуляторный перфоратор SDS-Max производства Германия для работ по бетону.',
      }),
    ).toEqual({});
  });

  it('rejects phones, links, prices and markup', () => {
    const check = (text: string) =>
      validateAnswer(BOSCH, { descriptionShort: text }).descriptionShort;
    expect(
      check('Звоните +375 (29) 668-00-11, перфоратор для бетона и кирпича.'),
    ).toMatch(/телефон/);
    expect(
      check('Подробнее на сайте dukon.by — перфоратор для бетона и кирпича.'),
    ).toMatch(/ссылка/);
    expect(
      check('**Перфоратор** для бетона и кирпича, для строительных бригад.'),
    ).toMatch(/разметка/);
  });

  it('keeps the brand, the model code and the numbers of the old name', () => {
    expect(
      validateAnswer(BOSCH, {
        name: 'Аккумуляторный перфоратор GBH 18V-45 C SDS-Max',
      }).name,
    ).toBe('пропал бренд «Bosch»');
    expect(
      validateAnswer(BOSCH, {
        name: 'Аккумуляторный перфоратор Bosch GBH SDS-Max в кейсе',
      }).name,
    ).toMatch(/пропал код или модель «18V-45»/);

    const starfix = {
      entity: 'PRODUCT' as const,
      oldName: 'Анкер забиваемый М10х12х40 мм (4 шт в зип-локе) STARFIX',
      brand: 'STARFIX',
      source: 'Анкер забиваемый М10х12х40 мм (4 шт в зип-локе) STARFIX',
    };
    expect(
      validateAnswer(starfix, { name: 'Анкер забиваемый М10х12х40 мм STARFIX' })
        .name,
    ).toBe('пропало число 4 из старого названия');
    expect(
      validateAnswer(starfix, {
        name: 'Анкер забиваемый STARFIX М10х12х40 мм, 4 шт. в зип-пакете',
      }),
    ).toEqual({});
  });

  it('fixes homoglyph names instead of keeping them', () => {
    const toptul = {
      entity: 'PRODUCT' as const,
      oldName: 'Kлeщи для xoмутoв ШPУCa уcилeнныe TOPTUL',
      brand: 'TOPTUL',
      source: 'Kлeщи для xoмутoв ШPУCa уcилeнныe TOPTUL',
    };
    expect(
      validateAnswer(toptul, {
        name: 'Клещи для хомутов ШРУСа усиленные TOPTUL',
      }),
    ).toEqual({});
    expect(
      validateAnswer(toptul, {
        name: 'Kлeщи для хомутов ШРУСа усиленные TOPTUL',
      }).name,
    ).toMatch(/смешанных/);
  });

  it('takes Latin M and x in sizes for the Cyrillic ones the supplier typed', () => {
    const starfix = {
      entity: 'PRODUCT' as const,
      oldName: 'Анкер забиваемый М10х12х40 мм (4 шт в зип-локе) STARFIX',
      brand: 'STARFIX',
      source: 'Анкер забиваемый М10х12х40 мм (4 шт в зип-локе) STARFIX',
    };
    expect(
      validateAnswer(starfix, {
        name: 'Анкер забиваемый STARFIX M10x12x40 мм, 4 шт. в зип-пакете',
        descriptionShort:
          'Анкер забиваемый M10x12x40 мм для крепления к бетону, 4 шт. в упаковке.',
      }),
    ).toEqual({});
  });

  it('does not read ordinary words as claims', () => {
    const check = (text: string) =>
      validateAnswer(BOSCH, { descriptionShort: text }).descriptionShort;
    expect(
      check(
        'Контроль отдачи снижает риск резкой реакции инструмента при заклинивании бура.',
      ),
    ).toBeUndefined();
    expect(
      check(
        'Перфоратор подходит для работы на складе, в цехе и на строительном объекте.',
      ),
    ).toBeUndefined();
    expect(
      check(
        'Перфоратор идеально подходит для сверления бетона на строительных объектах.',
      ),
    ).toBeUndefined();
    expect(
      check(
        'Перфоратор для бетона, он всегда есть на складе нашего магазина в Беларуси.',
      ),
    ).toMatch(/наличие/);
  });

  it('does not take a length for a phone', () => {
    const bolt = {
      entity: 'PRODUCT' as const,
      oldName: 'Болторез 375мм TOPTUL',
      brand: 'TOPTUL',
      source: 'Болторез 375мм TOPTUL; Длина, мм: 375; Число оборотов: 37500',
    };
    expect(
      validateAnswer(bolt, {
        descriptionShort:
          'Болторез TOPTUL длиной 375 мм для перекусывания прутков и болтов.',
      }),
    ).toEqual({});
  });

  it('accepts a long name that keeps everything the supplier listed', () => {
    const old =
      'Аккум. дрель-шуруповерт BULL SR 1805 Xcase XLTpro, 2х6 А*ч, БЕСЩЕТ., 18 В, 60 Н*м, 2 скор., 13 мм патрон, LED, реверс';
    const bull = {
      entity: 'PRODUCT' as const,
      oldName: old,
      brand: 'BULL',
      source: old,
    };
    const name =
      'Аккумуляторная дрель-шуруповерт BULL SR 1805 Xcase XLTpro, бесщеточная, 18 В, 60 Н·м, 2 аккумулятора по 6 А·ч, 2 скорости, патрон 13 мм, подсветка LED, реверс';
    expect(name.length).toBeGreaterThan(150);
    expect(validateAnswer(bull, { name })).toEqual({});
  });

  it('lets a name be mostly brand and series', () => {
    const old = '10х100х160 мм бур (сверло) SDS-plus EXPERT STARTUL';
    const bit = {
      entity: 'PRODUCT' as const,
      oldName: old,
      brand: 'STARTUL',
      source: old,
    };
    expect(
      validateAnswer(bit, {
        name: 'Бур (сверло) SDS-plus EXPERT STARTUL 10х100х160 мм',
      }),
    ).toEqual({});
  });

  // The pilot's false refusals, 29.10.
  it('does not glue an article to a size («GP0801-350 350х25»)', () => {
    const old = 'Алмазный круг 350х20/25.4 мм по бетону сегмент. GEPARD';
    const disc = {
      entity: 'PRODUCT' as const,
      oldName: old,
      brand: 'GEPARD',
      source: `${old}\nАртикул: GP0801-350`,
    };
    expect(
      validateAnswer(disc, {
        name: 'Алмазный круг сегментный GEPARD GP0801-350 350х25,4/20 мм по бетону',
      }),
    ).toEqual({});
  });

  it('accepts a size made exact from the specs («125х22» → «125х22,2»)', () => {
    const old =
      'Алмазный круг 125х22 мм универс. Turbo EXPERT STARTUL (SE8004-125)';
    const disc = {
      entity: 'PRODUCT' as const,
      oldName: old,
      brand: 'STARTUL',
      source: `${old}\nПосадочный диаметр: 22.2`,
    };
    expect(
      validateAnswer(disc, {
        name: 'Алмазный круг 125х22.2 мм универсальный Turbo EXPERT STARTUL SE8004-125',
      }),
    ).toEqual({});
  });

  it('reads «ДxШxВ» as a dimension label, not a look-alike word', () => {
    const bag = {
      entity: 'PRODUCT' as const,
      oldName: 'Сумка BULL WB 5520',
      brand: 'BULL',
      source: 'Сумка BULL WB 5520; 36 x 23 x 25 см; 3.55 кг',
    };
    expect(
      validateAnswer(bag, {
        descriptionFull:
          'Сумка для инструмента BULL WB 5520. Габариты ДxШxВ: 36 x 23 x 25 см, вес 3,55 кг. '.repeat(
            2,
          ),
      }),
    ).toEqual({});
  });

  it('lets a name end in «шт.» and carry Latin capitals', () => {
    const old = 'Бокорезы 160мм EXPERT STARTUL (SE4260-16)';
    const nippers = {
      entity: 'PRODUCT' as const,
      oldName: old,
      brand: 'STARTUL',
      source: old,
    };
    expect(
      validateAnswer(nippers, {
        name: 'Бокорезы EXPERT STARTUL SE4260-16 160 мм',
      }),
    ).toEqual({});
    const keys = {
      entity: 'PRODUCT' as const,
      oldName: 'Ключ 005 (2шт.) для тележек TOPTUL',
      brand: 'TOPTUL',
      source: 'Ключ 005 (2шт.) для тележек TOPTUL',
    };
    expect(
      validateAnswer(keys, { name: 'Ключ TOPTUL 005 для тележек, 2 шт.' }),
    ).toEqual({});
  });

  it('keeps a unit translated and an abbreviation spelled out', () => {
    const check = (oldName: string, name: string) =>
      validateAnswer(
        { entity: 'PRODUCT' as const, oldName, brand: null, source: oldName },
        { name },
      );
    expect(
      check(
        'Клещи д/снятия изоляции 150мм диэлектрические 1000V TOPTUL',
        'Клещи для снятия изоляции 150 мм диэлектрические 1000 В TOPTUL',
      ),
    ).toEqual({});
    expect(
      check(
        'Рубанок аккум. LXT BL 18В, ширина 82мм',
        'Аккумуляторный рубанок LXT бесщеточный 18 В, ширина 82 мм',
      ),
    ).toEqual({});
    expect(
      check(
        'Адаптер SDS+BiM коронок 32-76мм MAKITA',
        'Адаптер SDS+ для биметаллических коронок 32-76 мм MAKITA',
      ),
    ).toEqual({});
    // A code that is really gone is still caught.
    expect(
      check('Перфоратор MAKITA HR2470 в чем.', 'Перфоратор MAKITA в кейсе')
        .name,
    ).toMatch(/HR2470/);
  });

  it('does not read the pronoun «сам» as a superlative', () => {
    expect(
      validateAnswer(BOSCH, {
        descriptionShort:
          'Заряд можно контролировать по самому инструменту, если у него есть индикатор.',
      }),
    ).toEqual({});
    expect(
      validateAnswer(BOSCH, {
        descriptionShort:
          'Самый мощный перфоратор для работ по бетону на объектах.',
      }).descriptionShort,
    ).toMatch(/превосходная/);
  });

  it('wants the B2B payment line in the SEO description', () => {
    expect(
      validateAnswer(BOSCH, {
        seoDescription:
          'Аккумуляторный перфоратор Bosch GBH 18V-45 C SDS-Max, 18 В, 12,5 Дж. Доставка по Беларуси.',
      }).seoDescription,
    ).toBe('нет упоминания оплаты по безналу');
  });

  it('keeps a thin card to one paragraph', () => {
    const thin = {
      entity: 'PRODUCT' as const,
      oldName: '(К-Т 6)Съемник внутренних стопорных колец изогнутый 200мм',
      brand: 'PATRON',
      source:
        '(К-Т 6)Съемник внутренних стопорных колец изогнутый 200мм PATRON P-9U0102',
      thin: true,
    };
    expect(
      validateAnswer(thin, {
        descriptionFull:
          'Съемник внутренних стопорных колец изогнутый, длина 200 мм. '.repeat(
            20,
          ),
      }).descriptionFull,
    ).toMatch(/мало данных/);
  });
});
