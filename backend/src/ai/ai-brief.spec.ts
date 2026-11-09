import { lineInfo, repairMessage, repairNotes } from './ai-brief';

describe('lineInfo', () => {
  it('names this variant and its siblings by the sizes in the names', () => {
    expect(
      lineInfo('Шарошка цилиндрическая по металлу (Ø 8мм, Ø хвостовика 6мм)', [
        'Шарошка цилиндрическая по металлу (Ø 12мм, Ø хвостовика 6мм)',
        'Шарошка цилиндрическая по металлу (Ø 6мм, Ø хвостовика 6мм)',
        'Шарошка цилиндрическая по металлу (Ø 6мм, Ø хвостовика 6мм)',
      ]),
    ).toEqual({
      thisVariant: 'Ø 8 мм',
      otherVariants: ['Ø 12 мм', 'Ø 6 мм'],
    });
  });

  it('nothing for a name without sizes or a line of one', () => {
    expect(
      lineInfo('Перфоратор WORTEX CRH 1810', ['Перфоратор WORTEX CRH 1822']),
    ).toBeNull();
    expect(lineInfo('Ключ рожковый 14 мм', ['Ключ рожковый 14 мм'])).toBeNull();
  });
});

describe('repairMessage', () => {
  it('lists each failed field with its reason and the copied pieces', () => {
    const text = repairMessage(
      repairNotes(
        'p1',
        {
          descriptionFull: 'уникальность 31% — почти текст поставщика',
          name: 'пропал бренд',
        },
        {
          descriptionFull: [
            'изогнуты на 75° для работы в труднодоступных местах',
          ],
        },
      ),
    );
    expect(text).toMatch(/id p1, поле "descriptionFull": уникальность 31%/);
    expect(text).toMatch(
      /«изогнуты на 75° для работы в труднодоступных местах»/,
    );
    expect(text).toMatch(/id p1, поле "name": пропал бренд\./);
    expect(text).toMatch(/только эти id и только эти поля/);
  });
});
