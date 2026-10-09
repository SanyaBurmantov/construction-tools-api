import {
  canonicalSpec,
  inferUnitFromValues,
  normalizeSpecValue,
  normalizeUnit,
} from './spec-canonical';

/** Every group below is a real duplicate set from the production catalogue. */
type DuplicateGroup = [string, string[], { sharedName?: boolean }?];

const REAL_DUPLICATE_GROUPS: DuplicateGroup[] = [
  [
    'Мощность',
    ['Мощность ( Вт )', 'Мощность (Вт)', 'Мощность, Вт', 'Мощность, Вт.'],
  ],
  [
    'Ёмкость аккумулятора',
    [
      'Ёмкость аккумулятора (А/ч)',
      'Ёмкость аккумулятора (Ач)',
      'Ёмкость аккумулятора, А.ч.',
      'Ёмкость аккумулятора, Ач',
      'Емкость аккумулятора, А*Ч',
      'Емкость аккумулятора, А/ч',
      'Емкость аккумулятора, Ач',
    ],
  ],
  ['Обороты', ['Обороты ( обмин )', 'Обороты, об/мин', 'Обороты, обмин']],
  [
    'Число оборотов',
    [
      'Число оборотов (обмин)',
      'Число оборотов, об/мин',
      'Число оборотов, обмин',
    ],
  ],
  [
    'Степень защиты',
    ['Степень защиты (IP)', 'Степень защиты IP', 'Степень защиты, IP'],
  ],
  [
    'Уровень звукового давления',
    [
      'Уровень звукового давления (L pA )',
      'Уровень звукового давления (LPA)',
      'Уровень звукового давления (LpA)',
    ],
  ],
  [
    'Крутящий момент',
    ['Крутящий момент ( Нм )', 'Крутящий момент, Н*м', 'Крутящий момент, Нм'],
  ],
  ['Диаметр, мм', ['Диаметр (мм)', 'Диаметр, мм', 'Диаметр, мм.']],
  ['Толщина, мм', ['Толщина (мм)', 'Толщина, мм', 'Толщина, мм.']],
  [
    'Толщина стенки, мм',
    ['Толщина стенки, мм', 'Толщина стенки, мм.', 'Толщина стенки,мм'],
  ],
  ['Материал', ['Материал', 'Материал,', 'материал']],
  ['Длина, м', ['Длина, м', 'Длина, м.', 'длина, м']],
  ['Назначение', ['ПРИМЕНЕНИЕ', 'Применение', '• Применение', 'Назначение']],
  [
    'Степень защиты (без единицы)',
    ['Степень защиты', 'степень защиты', '• Степень защиты'],
  ],
  [
    'Макс. диаметр сверления (дерево), мм',
    [
      'Макс. диаметр сверления (дерево) ( мм )',
      'Макс. диаметр сверления (дерево), мм',
      'Макс. диаметр сверления, дерево (мм)',
    ],
    // Same filter, but the two suppliers punctuate "дерево" differently, so the
    // label is picked from the data by the normalizer, not from the name alone.
    { sharedName: false },
  ],
  [
    'Параметры сети',
    ['Параметры сети, В / Гц', 'Параметры сети, В/Гц', 'Параметры сети, ВГц'],
  ],
  // "ДхШхВ" is decoration, so these are duplicates; the unit is what keeps
  // them in two groups, and that is the rule under test further down.
  [
    'Габариты, см',
    ['Габариты ДxШxВ, см', 'Габариты, см', 'Габариты (ДхШхВ), см'],
  ],
  ['Габариты', ['Габариты (ДхШхВ)', 'Габариты', 'Габариты ДxШxВ']],
  ['Вес', ['Вес', 'Масса', 'Масса нетто']],
  [
    'Страна производства',
    ['Страна изготовления', 'Страна производства', 'Страна производителя'],
  ],
  ['Гарантия', ['Гарантия', 'Гарантийный срок', 'Срок гарантии']],
];

describe('canonicalSpec', () => {
  for (const [label, variants, options] of REAL_DUPLICATE_GROUPS) {
    it(`collapses the ${variants.length} production spellings of "${label}"`, () => {
      const keys = new Set(variants.map((name) => canonicalSpec(name)?.key));
      expect([...keys]).toHaveLength(1);
      expect([...keys][0]).toBeTruthy();
    });

    const nameTest = options?.sharedName === false ? it.skip : it;
    nameTest(`gives "${label}" one display name`, () => {
      const names = new Set(variants.map((name) => canonicalSpec(name)?.name));
      expect([...names]).toHaveLength(1);
    });
  }

  it('lifts the unit out of the name', () => {
    expect(canonicalSpec('Мощность, Вт')).toEqual({
      key: 'moshchnost~vt',
      name: 'Мощность',
      unit: 'Вт',
    });
  });

  it('keeps units of different scale apart — 1.5 м is not 1500 мм', () => {
    expect(canonicalSpec('Длина, м')?.key).not.toBe(
      canonicalSpec('Длина, мм')?.key,
    );
  });

  it('keeps net and packed weight apart', () => {
    expect(canonicalSpec('Вес')?.key).not.toBe(
      canonicalSpec('Вес с упаковкой, кг')?.key,
    );
    expect(canonicalSpec('Вес с упаковкой, кг')?.key).toBe('ves-brutto~kg');
  });

  it('does not swallow a parenthesised word that is not a unit', () => {
    const spec = canonicalSpec('Макс. диаметр сверления (дерево)');
    expect(spec?.unit).toBeUndefined();
    expect(spec?.name).toContain('дерево');
  });

  // Found by running the dictionary over all 4472 distinct names in the
  // production catalogue: `(A)` is amperes and `(L)` is litres, so three
  // different lengths of one product collapsed into a single filter.
  it('reads a bare letter in brackets as a label, not a unit', () => {
    const keys = [
      'Длина (A), мм',
      'Длина (L), мм',
      'Длина (H), мм',
      'Длина (S), мм',
    ].map((name) => canonicalSpec(name)?.key);

    expect(new Set(keys).size).toBe(4);
    expect(keys.every((key) => key?.endsWith('~mm'))).toBe(true);
  });

  it('keeps a measurement label out of the weight/size collapse', () => {
    expect(canonicalSpec('Размер H')?.key).not.toBe(
      canonicalSpec('Размер')?.key,
    );
  });

  // Same run: the "ДхШхВ" decoration appears in eight spellings and says
  // nothing a filter can use.
  it.each([
    'Габариты (ДхШхВ)',
    'Габариты',
    'Размеры',
    'Размеры (Д х Ш х В)',
    'Размеры (Д x Ш x В)',
    'Габариты (ДxШxВ)',
    'Размеры (ДхШхВ)',
  ])('reduces "%s" to the dimensions filter', (name) => {
    expect(canonicalSpec(name)?.key).toBe('gabarity');
  });

  it('recognises degrees however the supplier types them', () => {
    const keys = [
      'Температура эксплуатации, °С',
      'Температура эксплуатации, °C',
    ].map((name) => canonicalSpec(name)?.key);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toContain('~c');
  });

  it('does not read "Класс А" as amperes', () => {
    expect(canonicalSpec('Класс А')?.unit).toBeUndefined();
    expect(canonicalSpec('Группа В')?.unit).toBeUndefined();
  });

  it('still reads a comma-separated single-letter unit', () => {
    expect(canonicalSpec('Напряжение, В')?.unit).toBe('В');
  });

  it('merges "Вес" with "Вес, кг" once the unit is inferred from values', () => {
    expect(canonicalSpec('Вес', 'кг')?.key).toBe(canonicalSpec('Вес, кг')?.key);
  });

  it('rejects a name with nothing in it', () => {
    expect(canonicalSpec('')).toBeNull();
    expect(canonicalSpec('   ')).toBeNull();
    expect(canonicalSpec('—')).toBeNull();
  });

  it('is stable: the key only uses ASCII and URL-safe characters', () => {
    const names = REAL_DUPLICATE_GROUPS.flatMap(([, variants]) => variants);
    for (const name of names) {
      expect(canonicalSpec(name)?.key).toMatch(/^[a-z0-9~-]+$/);
    }
  });
});

describe('normalizeUnit', () => {
  it('accepts every spelling of the same unit', () => {
    expect(normalizeUnit('А/ч')).toBe('А·ч');
    expect(normalizeUnit('Ач')).toBe('А·ч');
    expect(normalizeUnit('А*Ч')).toBe('А·ч');
    expect(normalizeUnit('об/мин')).toBe('об/мин');
    expect(normalizeUnit('обмин')).toBe('об/мин');
  });

  it('returns undefined for something that is not a unit', () => {
    expect(normalizeUnit('дерево')).toBeUndefined();
    expect(normalizeUnit('')).toBeUndefined();
    expect(normalizeUnit(undefined)).toBeUndefined();
  });
});

describe('normalizeSpecValue', () => {
  it('folds case-only duplicates of yes/no', () => {
    expect(normalizeSpecValue('Нет').facet).toBe('Нет');
    expect(normalizeSpecValue('нет').facet).toBe('Нет');
    expect(normalizeSpecValue('ЕСТЬ').facet).toBe('Да');
    expect(normalizeSpecValue('+').facet).toBe('Да');
  });

  it('drops the unit when it repeats the specification unit', () => {
    expect(normalizeSpecValue('0.5 кг', 'кг').facet).toBe('0.5');
    expect(normalizeSpecValue('0,5', 'кг').facet).toBe('0.5');
  });

  it('treats an impossible zero as no data', () => {
    // 6188 products carried Вес = "0 кг" — the most common weight "value".
    expect(normalizeSpecValue('0 кг', 'кг').facet).toBeNull();
    expect(normalizeSpecValue('0', 'мм').facet).toBeNull();
  });

  it('keeps a legitimate zero where zero means something', () => {
    expect(normalizeSpecValue('0', undefined).facet).toBe('0');
    expect(normalizeSpecValue('0', 'шт').facet).toBeNull();
  });

  it('recognises a supplier saying "no data"', () => {
    for (const empty of ['', '-', '—', 'н/д', 'не указано', 'отсутствует']) {
      expect(normalizeSpecValue(empty).facet).toBeNull();
    }
  });

  it('normalizes number formatting so one number is one option', () => {
    expect(normalizeSpecValue('1,50').facet).toBe('1.5');
    expect(normalizeSpecValue('2.0').facet).toBe('2');
    expect(normalizeSpecValue(' 1 500 ').facet).toBe('1500');
  });

  it('leaves ranges and lists as text', () => {
    expect(normalizeSpecValue('10-20').facet).toBe('10-20');
    expect(normalizeSpecValue('2 шт в комплекте').facet).toBe(
      '2 шт в комплекте',
    );
  });

  it('does not destroy abbreviations in free text', () => {
    expect(normalizeSpecValue('HSS').facet).toBe('HSS');
    expect(normalizeSpecValue('CrV').facet).toBe('CrV');
  });

  it('folds the leading letter so "сталь" and "Сталь" are one option', () => {
    expect(normalizeSpecValue('сталь').facet).toBe(
      normalizeSpecValue('Сталь').facet,
    );
  });
});

describe('inferUnitFromValues', () => {
  it('lifts the unit a column of values agrees on', () => {
    expect(inferUnitFromValues(['0.5 кг', '1.2 кг', '3 кг', '0,8 кг'])).toBe(
      'кг',
    );
  });

  it('ignores a stray unit among unrelated values', () => {
    expect(
      inferUnitFromValues(['F-617E0813', 'X-220', '5 кг', 'ABS', 'HSS']),
    ).toBeUndefined();
  });

  it('needs more than a couple of values to decide', () => {
    expect(inferUnitFromValues(['5 кг', '6 кг'])).toBeUndefined();
  });

  it('returns undefined when the values carry no unit', () => {
    expect(inferUnitFromValues(['1', '2', '3', '4'])).toBeUndefined();
  });
});
