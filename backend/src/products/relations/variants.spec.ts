import { familyKey, variantName, variantOptions } from './variants';

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
  priceCurrency: 'BYN',
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
      'H7х30мм',
      '10мм',
    ]);
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
    expect(options.find((option) => !option.current)?.id).toBe('p2');
  });

  it('labels a size written twice once', () => {
    expect(
      labels('p0', [
        'Бита Torx T35 для винтов T35, 30 мм',
        'Бита Torx T25 для винтов T25, 30 мм',
      ]),
    ).toEqual(['T25', 'T35*']);
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
