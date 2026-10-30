import {
  accessorySignature,
  createBrandMatcher,
  extractModelReferences,
  isAccessory,
  matchReference,
  modelCode,
  ownModelCodes,
  referencePattern,
  targetSignature,
  type ModelReference,
  type RelationBrand,
  type TargetIdentity,
} from './compatibility';

const brands: RelationBrand[] = [
  { id: 'maker', name: 'Maker' },
  { id: 'other', name: 'Other' },
  { id: 'bull', name: 'BULL' },
  { id: 'makita', name: 'MAKITA' },
  { id: 'wortex', name: 'Wortex' },
  { id: 'bosch', name: 'Bosch' },
  { id: 'gepard', name: 'GEPARD' },
  { id: 'petropump', name: 'Petropump' },
  { id: 'helper', name: 'Помощник' },
  { id: 'short', name: 'РС' },
];
const matcher = createBrandMatcher(brands);
const accessory = (text: string, name = 'Фильтр F100') => ({
  name,
  descriptionShort: null,
  descriptionFull: text,
});
const codes = (references: ModelReference[]) =>
  references.map((reference) => [reference.brandId, reference.codes[0]]);
const tool = (
  id: string,
  name: string,
  brandId = 'maker',
  sku: string | null = null,
): TargetIdentity => ({ id, name, brandId, model: null, sku });
const fits = (reference: ModelReference, tools: TargetIdentity[]) =>
  matchReference(
    reference,
    tools.map((target) => ({
      target,
      codes: ownModelCodes(target, matcher.name(target.brandId)),
    })),
  ).map((target) => target.id);

describe('explicit compatibility', () => {
  it('extracts a branded model list and keeps suffixes', () => {
    expect(
      codes(
        extractModelReferences(
          accessory('Подходит для Maker VX100, VX100D и Other ZR200.'),
          brands,
        ),
      ),
    ).toEqual([
      ['maker', 'VX100'],
      ['maker', 'VX100D'],
      ['other', 'ZR200'],
    ]);
  });

  // Real supplier names from production.
  it.each([
    ['Мешок для пылесоса BOSCH GAS 25 сменный GEPARD', [['bosch', 'GAS25']]],
    [
      'Мешок для пылесоса BOSCH GAS 15, 12-25 сменный GEPARD',
      [
        ['bosch', 'GAS15'],
        ['bosch', 'GAS1225'],
      ],
    ],
    [
      'Мешок для пылесоса WORTEX VC 2014 WS, BOSCH ADVANCED VAC 20 сменный GEPARD',
      [
        ['wortex', 'VC2014WS'],
        ['bosch', 'ADVANCEDVAC20'],
      ],
    ],
    [
      'Фильтр HEPA для пылесоса Wortex VC 2515 WS в кор.',
      [['wortex', 'VC2515WS']],
    ],
    [
      'Щетка круглая к пылесосам BULL AS 3001, AS 3002',
      [
        ['bull', 'AS3001'],
        ['bull', 'AS3002'],
      ],
    ],
    ['Сопло №519 для BULL BAS 2223 0,019" 50 град.', [['bull', 'BAS2223']]],
    ['Головка триммерная для Wortex ТН 4217-1 S', [['wortex', 'TH42171S']]],
    ['Нож для триммера MAKITA 3 зуба, d- 255x25.4мм', []],
    ['Мешок для пылесоса MAKITA 18 В', []],
  ])('reads «%s»', (name, expected) => {
    expect(
      codes(extractModelReferences({ ...accessory(''), name }, matcher)),
    ).toEqual(expected);
  });

  it('regressions from the review: profiles, refrigerants, remarks, counts', () => {
    const kingTony = createBrandMatcher([
      ...brands,
      { id: 'kt', name: 'KING TONY' },
      { id: 'jtc', name: 'JTC' },
      { id: 'nb', name: 'NORDBERG' },
      { id: '3ton', name: '3TON' },
    ]);
    expect(
      extractModelReferences(
        {
          ...accessory(''),
          name: 'Вставка (бита) прецизионная для отвертки 91230, TORX T6 /TORX T10 KING TONY',
          brandId: 'kt',
        },
        kingTony,
      ).flatMap((r) => r.codes),
    ).not.toContain('TORXT6');
    expect(
      extractModelReferences(
        { ...accessory(''), name: 'Шланг заправочный для NORDBERG R134a' },
        kingTony,
      ),
    ).toEqual([]);
    expect(
      extractModelReferences(
        {
          ...accessory(''),
          name: 'Головка для JTC-1614 (MERCEDES 107, 114, 115, 116, 126)',
          brandId: 'jtc',
        },
        kingTony,
      ).flatMap((r) => r.codes),
    ).not.toContain('115');
    expect(
      ownModelCodes(
        tool('kit', 'Набор инструментов JTC-I4100S (115 предметов)', 'jtc'),
        'JTC',
      ),
    ).not.toContain('115');
    // A brand that starts with a digit is still a brand.
    expect(kingTony.at('3TON SH 3000')?.brand.id).toBe('3ton');
  });

  it('takes the accessory brand when the claim names only the model', () => {
    expect(
      codes(
        extractModelReferences(
          {
            ...accessory(''),
            name: 'Направл. шина 3000мм MAKITA для SP 6000',
            brandId: 'makita',
          },
          matcher,
        ),
      ),
    ).toEqual([['makita', 'SP6000']]);
    expect(
      extractModelReferences(
        { ...accessory(''), name: 'Направл. шина для SP 6000' },
        matcher,
      ),
    ).toEqual([]);
  });

  it('does not read the accessory own article as a tool', () => {
    expect(
      extractModelReferences(
        {
          ...accessory(''),
          name: 'Шприц для трансмиссионного масла Petropump PP100308, 500 мл',
          brandId: 'petropump',
          sku: 'PP100308',
        },
        matcher,
      ),
    ).toEqual([]);
  });

  it.each([
    'Не подходит для Maker VX100.',
    'Подходит для Maker VX100, кроме VX100D.',
    'Совместимость: Maker VX100 (не все модификации).',
    'Подходит для всех моделей Maker.',
    'Подходит для обработки древесины.',
    'Подходит для Unknown VX100.',
    'Подходит для VX100.',
    'Подходит для Maker 18 V.',
    'Подходит для Maker VX100–VX200.',
    'Подходит для Maker R12.',
  ])('does not infer compatibility from %s', (text) => {
    expect(extractModelReferences(accessory(text), brands)).toEqual([]);
  });

  it('reads a model up to a slash, the same way a tool name is read', () => {
    expect(
      codes(
        extractModelReferences(
          accessory('Подходит для Maker VX100/VX200.'),
          brands,
        ),
      ),
    ).toEqual([['maker', 'VX100']]);
  });

  it('keeps the models listed before the prose that follows them', () => {
    expect(
      codes(
        extractModelReferences(
          accessory('Подходит для Maker VX100 и других моделей.'),
          brands,
        ),
      ),
    ).toEqual([['maker', 'VX100']]);
  });

  it('reads a negation per sentence: «кроме того» elsewhere costs nothing', () => {
    expect(
      codes(
        extractModelReferences(
          accessory(
            'Кроме того, фильтр легко чистится. Подходит для Maker VX100.',
          ),
          brands,
        ),
      ),
    ).toEqual([['maker', 'VX100']]);
  });

  it('does not carry a brand across sentences or match a partial brand name', () => {
    expect(
      extractModelReferences(
        accessory('Подходит для Maker VX100. Подходит для ZR200.'),
        brands,
      ),
    ).toHaveLength(1);
    expect(
      extractModelReferences(accessory('Подходит для MakerPro VX100.'), brands),
    ).toEqual([]);
  });

  it('prefers the longest brand and ignores brands that are words or too short', () => {
    expect(
      codes(
        extractModelReferences(accessory('Подходит для Maker Pro VX100.'), [
          ...brands,
          { id: 'pro', name: 'Maker Pro' },
        ]),
      ),
    ).toEqual([['pro', 'VX100']]);
    expect(
      extractModelReferences(
        accessory('Подходит для помощник VX100.'),
        matcher,
      ),
    ).toEqual([]);
    expect(
      extractModelReferences(accessory('Подходит для РС VX100.'), matcher),
    ).toEqual([]);
  });

  it('deduplicates evidence and caps extracted references', () => {
    const item = accessory('Подходит для Maker VX100.');
    expect(
      extractModelReferences(
        { ...item, descriptionShort: item.descriptionFull },
        brands,
      ),
    ).toHaveLength(1);
    expect(
      extractModelReferences(
        accessory(
          `Подходит для Maker ${Array.from({ length: 30 }, (_, i) => `VX${100 + i}`).join(', ')}.`,
        ),
        brands,
      ),
    ).toHaveLength(16);
  });

  it('does not treat a tool supplied with an accessory as an accessory', () => {
    expect(isAccessory('Аккумуляторная дрель с аккумулятором')).toBe(false);
    expect(isAccessory('Пылесос с фильтром')).toBe(false);
    expect(isAccessory('Фильтр для пылесоса')).toBe(true);
    // The noun after «для» does not name the item.
    expect(
      isAccessory('Комплект для перемещения авто (2 комплекта адаптеров)'),
    ).toBe(false);
    expect(
      extractModelReferences(
        accessory('Подходит для Maker VX100.', 'Дрель с аккумулятором'),
        brands,
      ),
    ).toEqual([]);
  });

  it('reads an AI-renamed accessory from the supplier offer name', () => {
    const row = {
      ...accessory('Подходит для Maker VX100.'),
      name: 'Фильтр для пылесоса Maker VX200',
    };
    expect(
      codes(
        extractModelReferences(
          { ...row, aiLockedFields: ['name', 'descriptionFull'] },
          brands,
        ),
      ),
    ).toEqual([]);
    expect(
      codes(
        extractModelReferences(
          {
            ...row,
            aiLockedFields: ['name', 'descriptionFull'],
            sourceName: 'Фильтр для пылесоса Maker VX300',
          },
          brands,
        ),
      ),
    ).toEqual([['maker', 'VX300']]);
  });

  it('reads an AI-rewritten description from the supplier description', () => {
    const row = {
      ...accessory('Качественный фильтр для профессиональной уборки.'),
      aiLockedFields: ['descriptionFull'],
    };
    expect(extractModelReferences(row, brands)).toEqual([]);
    expect(
      codes(
        extractModelReferences(
          { ...row, sourceDescription: 'Подходит для Maker VX100.' },
          brands,
        ),
      ),
    ).toEqual([['maker', 'VX100']]);
    // Not locked: our own description is the evidence, the offer's is not read.
    expect(
      extractModelReferences(
        {
          ...accessory('Качественный фильтр.'),
          sourceDescription: 'Подходит для Maker VX100.',
        },
        brands,
      ),
    ).toEqual([]);
  });

  it('rejects contradictory statements across fields', () => {
    expect(
      extractModelReferences(
        {
          ...accessory('Не совместим с Maker VX100.'),
          name: 'Фильтр для Maker VX100',
        },
        brands,
      ),
    ).toEqual([]);
  });

  it('never accepts a model truncated by the text bound', () => {
    const prefix = ' '.repeat(11_970);
    expect(
      extractModelReferences(
        accessory(`${prefix}Подходит для Maker VX100D${'X'.repeat(100)}`),
        brands,
      ),
    ).toEqual([]);
  });
});

describe('tool model codes and matching', () => {
  it('reads the tool model from its name, before any «для»', () => {
    expect(
      ownModelCodes(
        tool('a', 'Пылесос BULL AS 3001 + аксессуары 1400 Вт, 30 л', 'bull'),
        'BULL',
      ),
    ).toEqual(['AS3001']);
    expect(
      ownModelCodes(
        tool(
          'b',
          'Безвоздушный окрасочный аппарат BULL BAS 2223 в коробке',
          'bull',
        ),
        'BULL',
      ),
    ).toEqual(['BAS2223']);
    expect(
      ownModelCodes(
        tool(
          'c',
          'Аккумулятор MAKITA LXT BL 1850B 18.0 В, 5.0 А/ч, Li-Ion',
          'makita',
        ),
        'MAKITA',
      ),
    ).toEqual(['LXTBL1850B', 'BL1850B']);
    expect(
      ownModelCodes(
        tool('d', 'Фильтр HEPA для пылесоса BULL AS 3001', 'bull'),
        'BULL',
      ),
    ).toEqual([]);
    // An accessory's article is not a tool model.
    expect(
      ownModelCodes(
        tool(
          'e',
          'Фильтр масло и вода для краскопульта JA-3808AN',
          'maker',
          'JA-3808AN',
        ),
      ),
    ).toEqual([]);
    expect(ownModelCodes(tool('f', 'Пила', 'makita', 'SP6000J'))).toEqual([
      'SP6000J',
    ]);
  });

  it('matches the exact model first, otherwise its kits — never a longer number', () => {
    const reference = (code: string): ModelReference => ({
      brandId: 'maker',
      codes: [code],
      field: 'name',
    });
    const tools = [
      tool('kit-a', 'Дрель-шуруповерт Maker DF 333 DWYE в чем.'),
      tool('kit-b', 'Дрель-шуруповерт Maker DF 333 DZ в кор.'),
      tool('long', 'Дрель Maker DF 3330'),
      tool('other-brand', 'Дрель Other DF 333', 'other'),
    ];
    expect(fits(reference('DF333'), tools)).toEqual(['kit-a', 'kit-b']);
    const exact = [...tools, tool('exact', 'Триммер Maker DF 333 в кор.')];
    expect(fits(reference('DF333'), exact)).toEqual(['exact']);
    expect(fits(reference('DF33'), tools)).toEqual([]);
  });

  it('links every listing of the same model — a markdown copy is the same tool', () => {
    const tools = [
      tool('new', 'Триммер Maker TE 4217-1 S в кор. 1500 Вт'),
      tool('markdown', 'Триммер Maker TE 4217-1 S в кор. 1500 Вт уцененный'),
      tool('plain', 'Триммер Maker TE 4217-1 в кор. 1300 Вт'),
    ];
    const [reference] = extractModelReferences(
      { ...accessory(''), name: 'Головка триммерная для Maker ТН 4217-1 S' },
      brands,
    );
    expect(fits(reference, tools)).toEqual([]);
    const [knife] = extractModelReferences(
      { ...accessory(''), name: 'Нож для триммера Maker TE 4217-1 S' },
      brands,
    );
    expect(fits(knife, tools).sort()).toEqual(['markdown', 'new']);
  });

  it('falls back from trailing words, not from suffixes or series letters', () => {
    const [hepa] = extractModelReferences(
      { ...accessory(''), name: 'Фильтр для пылесоса Maker AS 3001 HEPA' },
      brands,
    );
    expect(hepa.codes).toEqual(['AS3001HEPA', 'AS3001']);
    expect(fits(hepa, [tool('vac', 'Пылесос Maker AS 3001')])).toEqual(['vac']);
    const [series] = extractModelReferences(
      { ...accessory(''), name: 'Нож для триммера Maker TB 3018 AT' },
      brands,
    );
    expect(fits(series, [tool('head', 'Головка Maker ТН 3018 АТ')])).toEqual(
      [],
    );
  });

  it('builds a prefilter every spelling satisfies', () => {
    expect(
      referencePattern({
        brandId: 'b',
        codes: ['AS3001HEPA', 'AS3001'],
        field: 'name',
      }),
    ).toBe('%AS3001%');
  });

  it('normalizes single-value model columns', () => {
    expect(modelCode('GSR 18V-50')).toBe('GSR18V50');
    expect(modelCode('DF-333 D')).toBe('DF333D');
    expect(modelCode('123456')).toBeNull();
    expect(modelCode('18V')).toBeNull();
    expect(modelCode('BL1850B арт. 197280-8')).toBeNull();
  });
});

describe('signatures', () => {
  it('invalidate on evidence/identity changes, not on price or a tool text rewrite', () => {
    const row = {
      name: 'Фильтр',
      descriptionShort: null,
      descriptionFull: 'Подходит для Maker VX100.',
      aiLockedFields: [],
    };
    expect(accessorySignature(row)).not.toBe(
      accessorySignature({
        ...row,
        descriptionFull: 'Подходит для Maker VX100D.',
      }),
    );
    expect(accessorySignature(row)).not.toBe(
      accessorySignature({ ...row, aiLockedFields: ['descriptionFull'] }),
    );
    const target = {
      name: 'Пылесос Maker VX100',
      brandId: 'b',
      model: null,
      sku: '1',
    };
    expect(targetSignature(target)).not.toBe(
      targetSignature({ ...target, model: 'VX100D' }),
    );
    expect(targetSignature(target)).toHaveLength(32);
  });
});
