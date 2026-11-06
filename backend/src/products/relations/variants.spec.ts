import {
  familyKey,
  productFamily,
  variantName,
  variantOptions,
  withoutArticle,
} from './variants';

const member = (
  id: string,
  name: string,
  priceValue = 1,
  stockStatus = 'in_stock',
) => ({
  id,
  slug: id,
  name,
  priceValue,
  stockStatus,
});
const labels = (current: string, names: string[]) =>
  variantOptions(
    member(current, names.find((_, i) => `p${i}` === current)!),
    names.map((name, i) => member(`p${i}`, name)),
  ).map((option) => `${option.label}${option.current ? '*' : ''}`);

// Real names from the production catalogue.
describe('size variants', () => {
  it('masks sizes, keeps standards and leaves the pack out', () => {
    expect(
      variantName(
        'Болт М6х40 мм шестигр. с гайкой и шайбами, DIN 933 (8 шт в зип-локе) STARFIX',
      ),
    ).toEqual({
      template: 'болт § шестигр. с гайкой и шайбами, din 933 starfix',
      values: ['М6х40 мм'],
    });
    expect(
      variantName('Тройник ПП комб. вн. 25х3/4", сер. РТП')?.values,
    ).toEqual(['25х3/4"']);
    expect(variantName('Бита 6-гранная H7х30мм,10мм')?.values).toEqual([
      'H7х30 мм',
      '10 мм',
    ]);
  });

  it('keeps a strength class written out by the AI in the name', () => {
    expect(
      familyKey(
        'Болт шестигранный М10х80 мм, цинк, класс прочности 8.8, DIN 933 STARFIX',
        'b',
        'c',
      ),
    ).toBe(
      familyKey(
        'Болт шестигранный М10х40 мм, цинк, класс прочности 8.8, DIN 933 STARFIX',
        'b',
        'c',
      ),
    );
  });

  it('reads one size written with and without a space as one', () => {
    expect(
      labels('p0', [
        'Саморез 3.5х32мм для ГКЛ к металлу, фосфат STARFIX',
        'Саморез 3.5х32 мм для ГКЛ к металлу, фосфат STARFIX',
        'Саморез 3.5х25 мм для ГКЛ к металлу, фосфат STARFIX',
      ]),
    ).toEqual(['3.5х25 мм', '3.5х32 мм*']);
  });

  it('does not read letters inside a code as a size', () => {
    expect(
      variantName('Головка торцевая JONNESWAY S04H2109 (1/4", 9 мм)')?.values,
    ).toEqual(['1/4"', '9 мм']);
  });

  it('never makes a family of power tools, codes or models', () => {
    expect(
      variantName(
        'Одноручная углошлифмашина WORTEX AG 1209-3 в кор. 900 Вт, 125 мм',
      ),
    ).toBeNull();
    expect(
      variantName('Газонокосилка бензиновая ECO LG-435 уцененный (1991552272)'),
    ).toBeNull();
    expect(
      variantName('Пластиковая емкость для смешивания краски JETA PRO 5868068'),
    ).toBeNull();
    expect(variantName('Окрасочный агрегат HYVST SPX 1100-250')).toBeNull();
    expect(
      variantName('Архивный металлический стеллаж СТФ 744-1,8'),
    ).toBeNull();
    expect(variantName('Молоток СТАНКОИМПОРТ CS-15.50.300')).toBeNull();
  });

  it('switches between sizes of one line, ordered by size, the current one marked', () => {
    expect(
      labels('p1', [
        'Сверло по металлу ц/х 8.0х75х117 мм HSS-Co GEPARD',
        'Сверло по металлу ц/х 6.0х57х93 мм HSS-Co GEPARD',
        'Сверло по металлу ц/х 10.0х87х133 мм HSS-Co GEPARD',
        'Сверло по металлу ц/х 6.0х57х93 мм HSS-G GEPARD',
      ]),
    ).toEqual(['6.0х57х93 мм*', '8.0х75х117 мм', '10.0х87х133 мм']);
  });

  it('keeps one card per size: the same pack as the current one first', () => {
    expect(
      labels('p0', [
        'Дюбель распорный 6х30 мм (100 шт в пакете) STARFIX',
        'Дюбель распорный 8х40 мм (500 шт в пакете) STARFIX',
        'Дюбель распорный 8х40 мм (100 шт в пакете) STARFIX',
      ]),
    ).toEqual(['6х30 мм*', '8х40 мм']);
    const options = variantOptions(
      member('p0', 'Дюбель распорный 6х30 мм (100 шт в пакете) STARFIX'),
      [
        member('p1', 'Дюбель распорный 8х40 мм (500 шт в пакете) STARFIX', 5),
        member('p2', 'Дюбель распорный 8х40 мм (100 шт в пакете) STARFIX', 9),
      ],
    );
    expect(options.find((option) => !option.current)?.slug).toBe('p2');
  });

  it('labels a size written twice once', () => {
    expect(
      labels('p0', [
        'Бита Torx T35 для винтов T35, 30 мм',
        'Бита Torx T25 для винтов T25, 30 мм',
      ]),
    ).toEqual(['T25', 'T35*']);
  });

  it('keeps an AI-renamed card in its line by the supplier name', () => {
    const supplier = productFamily({
      name: 'Сверло по металлу ц/х 8.0х75х117 мм HSS-Co GEPARD',
      brandId: 'b',
      categoryId: 'c',
    });
    const renamed = productFamily({
      name: 'Сверло по металлу с цилиндрическим хвостовиком 6.0х57х93 мм HSS-Co GEPARD',
      sourceName: 'Сверло по металлу ц/х 6.0х57х93 мм HSS-Co GEPARD',
      aiLockedFields: ['name'],
      brandId: 'b',
      categoryId: 'c',
    });
    expect(renamed.familyKey).toBe(supplier.familyKey);
    expect(renamed.keyName).toBe(
      'Сверло по металлу ц/х 6.0х57х93 мм HSS-Co GEPARD',
    );
  });

  it('lets an admin draw a line across different names, or keep a card out', () => {
    const line = (name: string, variantLine: string | null) =>
      productFamily({ name, variantLine, brandId: 'b', categoryId: 'c' })
        .familyKey;
    expect(line('Шуруповёрт X 12 В', 'Линейка X')).toBe(
      line('Дрель-шуруповёрт X Pro 18 В', ' линейка  x '),
    );
    expect(line('Анкер рамный 10х92 мм', '—')).toBeNull();
    const options = variantOptions(
      member('a', 'Шуруповёрт X 12 В'),
      [
        { ...member('b', 'Дрель-шуруповёрт X Pro 18 В'), label: 'Pro 18 В' },
        member('a', 'Шуруповёрт X 12 В'),
      ],
      true,
    );
    expect(options.map((o) => [o.label, o.current])).toEqual([
      ['12', true],
      ['Pro 18 В', false],
    ]);
  });

  // Real names (2026-11-06): a per-size article in the name kept every size
  // its own family, so taps and sockets had no size switch.
  it("takes the card's own article out of the name before reading sizes", () => {
    const taps = [
      [
        '122405-M10*0,75',
        'GARWIN INDUSTRIAL 122405-M10*0,75 Метчик машинный М10х0,75 HSS-E, DIN 374, 6H, форма В, тип N',
      ],
      [
        '122405-M10*1,25',
        'GARWIN INDUSTRIAL 122405-M10*1,25 Метчик машинный М10х1,25 HSS-E, DIN 374, 6H, форма В, тип N',
      ],
      [
        '122405-M12*1,25',
        'GARWIN INDUSTRIAL 122405-M12*1,25 Метчик машинный М12х1,25 HSS-E, DIN 374, 6H, форма В, тип N',
      ],
    ].map(([sku, name]) =>
      productFamily({ name, sku, brandId: 'g', categoryId: 'c' }),
    );
    expect(new Set(taps.map((tap) => tap.familyKey)).size).toBe(1);
    expect(taps[1].familyKey).not.toBeNull();
    expect(taps[1].keyName).toBe(
      'GARWIN INDUSTRIAL Метчик машинный М10х1,25 HSS-E, DIN 374, 6H, форма В, тип N',
    );
    expect(
      labels(
        'p1',
        taps.map((tap) => tap.keyName),
      ),
    ).toEqual(['М10х0,75', 'М10х1,25*', 'М12х1,25']);

    const thorvik = [
      ['FS21213', 'Головка торцевая 12-гранная 1/2"DR 13 мм Thorvik FS21213'],
      ['FS21217', 'Головка торцевая 12-гранная 1/2"DR 17 мм Thorvik FS21217'],
    ].map(([sku, name]) =>
      productFamily({ name, sku, brandId: 't', categoryId: 'c' }),
    );
    expect(thorvik[0].familyKey).toBe(thorvik[1].familyKey);
    expect(
      labels(
        'p0',
        thorvik.map((s) => s.keyName),
      ),
    ).toEqual(['13 мм*', '17 мм']);

    const ombra = [
      ['112308', 'Головка торцевая 12-гранная Ombra 112308 (1/2"DR, 8 мм)'],
      ['112310', 'Головка торцевая 12-гранная Ombra 112310 (1/2"DR, 10 мм)'],
    ].map(([sku, name]) =>
      productFamily({ name, sku, brandId: 'o', categoryId: 'c' }),
    );
    expect(ombra[0].familyKey).toBe(ombra[1].familyKey);
    expect(
      labels(
        'p1',
        ombra.map((s) => s.keyName),
      ),
    ).toEqual(['8 мм', '10 мм*']);
  });

  it('reads a size glued to «6гр.» (Yato)', () => {
    expect(
      labels('p0', [
        "Головка торцевая 1/2''6гр.13мм L-38мм",
        "Головка торцевая 1/2''6гр.17мм L-38мм",
      ]),
    ).toEqual(['13 мм*', '17 мм']);
  });

  it('leaves a name alone when the article is not a whole token of it', () => {
    expect(withoutArticle('Болт DIN 933 M8x20', 'M8x2')).toBe(
      'Болт DIN 933 M8x20',
    );
    expect(withoutArticle('Ключ 10 мм', 'ABC')).toBe('Ключ 10 мм');
    expect(withoutArticle('Ключ 12345 10 мм', null)).toBe('Ключ 12345 10 мм');
  });

  it('keys a family by brand, or by category when there is none', () => {
    const a = familyKey('Анкер рамный 10х92 мм', 'b', 'c1');
    expect(a).toBe(familyKey('Анкер рамный 10х112 мм', 'b', 'c2'));
    expect(a).not.toBe(familyKey('Анкер рамный 10х112 мм', 'other', 'c1'));
    expect(familyKey('Анкер рамный 10х92 мм', null, 'c1')).not.toBe(
      familyKey('Анкер рамный 10х112 мм', null, 'c2'),
    );
    expect(familyKey('Перчатки', 'b', 'c')).toBeNull();
  });
});
