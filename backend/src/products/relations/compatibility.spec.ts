import {
  compatibilitySignature,
  extractModelReferences,
  isAccessory,
  matchesReference,
  modelCode,
  type RelationIdentity,
} from './compatibility';

const brands = [
  { id: 'maker', name: 'Maker' },
  { id: 'other', name: 'Other' },
];
const accessory = (text: string, name = 'Фильтр F100') => ({
  name,
  descriptionShort: null,
  descriptionFull: text,
});

describe('explicit compatibility', () => {
  it('extracts a branded model list and keeps suffixes', () => {
    expect(
      extractModelReferences(
        accessory('Подходит для Maker VX100, VX100D и Other ZR200.'),
        brands,
      ),
    ).toEqual([
      { brandId: 'maker', code: 'VX100', field: 'descriptionFull' },
      { brandId: 'maker', code: 'VX100D', field: 'descriptionFull' },
      { brandId: 'other', code: 'ZR200', field: 'descriptionFull' },
    ]);
  });

  it('supports explicit references in accessory names', () => {
    expect(
      extractModelReferences(
        accessory('', 'Фильтр для пылесоса Maker VX100'),
        brands,
      ),
    ).toEqual([{ brandId: 'maker', code: 'VX100', field: 'name' }]);
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
    'Подходит для Maker VX100/VX200.',
    'Подходит для Maker VX100 и других моделей.',
  ])('does not infer compatibility from %s', (text) => {
    // A trailing unsupported list part must invalidate the whole statement.
    expect(extractModelReferences(accessory(text), brands)).toEqual([]);
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

  it('rejects ambiguous brand spellings', () => {
    expect(
      extractModelReferences(accessory('Подходит для Maker Pro VX100.'), [
        ...brands,
        { id: 'pro', name: 'Maker Pro' },
      ]),
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

  it('requires the complete identifier and brand', () => {
    const ref = { brandId: 'maker', code: 'VX100', field: 'name' as const };
    expect(
      matchesReference(ref, { brandId: 'maker', model: 'VX-100', sku: null }),
    ).toBe(true);
    expect(
      matchesReference(ref, { brandId: 'maker', model: 'VX100D', sku: null }),
    ).toBe(false);
    expect(
      matchesReference(ref, { brandId: 'other', model: 'VX100', sku: null }),
    ).toBe(false);
    expect(
      matchesReference(ref, { brandId: 'maker', model: 'VX1000', sku: null }),
    ).toBe(false);
  });

  it('retains multipart model suffixes and refuses numeric-only codes', () => {
    expect(modelCode('GSR 18V-50')).toBe('GSR18V50');
    expect(modelCode('DF-333 D')).toBe('DF333D');
    expect(modelCode('123456')).toBeNull();
    expect(modelCode('18V')).toBeNull();
  });

  it('does not treat a tool supplied with an accessory as an accessory', () => {
    expect(isAccessory('Аккумуляторная дрель с аккумулятором')).toBe(false);
    expect(isAccessory('Пылесос с фильтром')).toBe(false);
    expect(isAccessory('Фильтр для пылесоса')).toBe(true);
    expect(
      extractModelReferences(
        accessory('Подходит для Maker VX100.', 'Дрель с аккумулятором'),
        brands,
      ),
    ).toEqual([]);
  });

  it('invalidates changed evidence/identity, ignoring price refreshes', () => {
    const row: RelationIdentity = {
      id: 'a',
      name: 'Фильтр',
      categoryId: 'c',
      brandId: 'b',
      model: null,
      sku: 'F100',
      descriptionShort: null,
      descriptionFull: 'Подходит для Maker VX100.',
      aiLockedFields: [],
    };
    expect(compatibilitySignature(row)).not.toBe(
      compatibilitySignature({
        ...row,
        descriptionFull: 'Подходит для Maker VX100D.',
      }),
    );
    expect(compatibilitySignature(row)).not.toBe(
      compatibilitySignature({ ...row, model: 'F100D' }),
    );
    expect(compatibilitySignature(row)).toHaveLength(32);
  });

  it('ignores AI-rewritten evidence and AI-rewritten product types', () => {
    const row = accessory('Подходит для Maker VX100.');
    expect(
      extractModelReferences(
        { ...row, aiLockedFields: ['descriptionFull'] },
        brands,
      ),
    ).toEqual([]);
    expect(
      extractModelReferences({ ...row, aiLockedFields: ['name'] }, brands),
    ).toEqual([]);
  });

  it('rejects contradictory statements across sentences and fields', () => {
    expect(
      extractModelReferences(
        accessory('Подходит для Maker VX100. Не подходит для Maker VX100.'),
        brands,
      ),
    ).toEqual([]);
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
