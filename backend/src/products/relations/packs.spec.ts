import { packOptions, parsePack } from './packs';

const listing = (id: string, name: string, priceValue: number | null) => ({
  id,
  slug: id,
  name,
  priceValue,
  priceCurrency: 'BYN',
  stockStatus: 'in_stock',
});

describe('packs', () => {
  it('reads a parenthesis that is only a pack', () => {
    expect(
      parsePack('Анкер забиваемый М10х12х40 мм (4 шт в зип-локе) STARFIX'),
    ).toMatchObject({
      quantity: 4,
      unit: 'шт',
      base: 'анкер забиваемый м10х12х40 мм starfix',
    });
    expect(
      parsePack('Болт М6х45 мм шестигр., цинк, DIN 933 (5 кг) STARFIX'),
    ).toMatchObject({
      quantity: 5,
      unit: 'кг',
    });
    expect(parsePack('Круг отрезной 125x1.2x22.2мм ( К-т 30шт)')).toMatchObject(
      {
        quantity: 30,
      },
    );
    // A load rating, not a pack.
    expect(
      parsePack('Магнит телескопический (7.26кг, L:180-770мм)'),
    ).toBeNull();
    // No size of its own: one text may hide several sizes.
    expect(parsePack('Chipboard screw, yellow galvanized (1000шт)')).toBeNull();
  });

  it('compares the family per piece, one listing per size', () => {
    const options = packOptions(
      listing(
        'a',
        'Шуруп универсальный 3.0х10 мм белый цинк (300 шт в пласт. конт.) STARFIX',
        5.53,
      ),
      [
        listing(
          'a',
          'Шуруп универсальный 3.0х10 мм белый цинк (300 шт в пласт. конт.) STARFIX',
          5.53,
        ),
        listing(
          'b',
          'Шуруп универсальный 3.0х10 мм белый цинк (100 шт в пласт. конт.) STARFIX',
          2.41,
        ),
        listing(
          'c',
          'Шуруп универсальный 3.0х10 мм белый цинк (2000 шт в коробе) STARFIX',
          20.58,
        ),
        listing(
          'd',
          'Шуруп универсальный 3.0х10 мм белый цинк (2000 шт в коробе) STARFIX',
          25,
        ),
        listing(
          'e',
          'Шуруп универсальный 3.0х12 мм белый цинк (100 шт в пласт. конт.) STARFIX',
          2,
        ),
        listing(
          'f',
          'Шуруп универсальный 3.0х10 мм белый цинк (5 кг) STARFIX',
          30,
        ),
        listing(
          'g',
          'Шуруп универсальный 3.0х10 мм белый цинк (50 шт) STARFIX',
          null,
        ),
      ],
    );
    expect(
      options.map((option) => [option.id, option.quantity, option.unitPrice]),
    ).toEqual([
      ['b', 100, 0.0241],
      ['a', 300, 0.0184],
      ['c', 2000, 0.0103],
    ]);
    expect(options.find((option) => option.current)?.id).toBe('a');
  });

  it('shows nothing without a second pack', () => {
    expect(
      packOptions(listing('a', 'Дюбель 6х30 мм (50 шт) STARFIX', 3), [
        listing('a', 'Дюбель 6х30 мм (50 шт) STARFIX', 3),
      ]),
    ).toEqual([]);
  });
});
