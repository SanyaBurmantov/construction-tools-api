import { batteryPlatform, fitmentTags, fitmentTitles } from './fitment';

const tags = (
  name: string,
  brandName?: string,
  specs?: Record<string, string>,
) =>
  fitmentTags({ name, brandName, specs }).map(
    (tag) => `${tag.role} ${tag.key}`,
  );

// Real names from the production catalogue.
describe('fitment by standard', () => {
  it('pairs cordless tools with batteries of their platform only', () => {
    expect(
      tags('Аккум. дрель-шуруповерт MAKITA LXT DDF 486 Z в кор.', 'MAKITA'),
    ).toEqual(['TOOL battery:makita-lxt', 'TOOL hex:1/4']);
    expect(
      tags('Аккумулятор MAKITA LXT BL 1850B 18.0 В, 5.0 А/ч, Li-Ion', 'MAKITA'),
    ).toEqual(['PART battery:makita-lxt']);
    expect(tags('Зарядное устройство MAKITA CXT DC 10 WD', 'MAKITA')).toEqual([
      'PART battery:makita-cxt',
    ]);
    expect(
      tags('Аккумулятор MAKITA XGT BL 4040 40.0 В, 4.0 А/ч, Li-Ion', 'MAKITA'),
    ).toEqual(['PART battery:makita-xgt']);
    // The G series does not fit LXT.
    expect(
      tags('Аккумулятор MAKITA BL1820G 18.0 В, 2.0 А/ч, Li-Ion', 'MAKITA'),
    ).toEqual([]);
    expect(
      tags(
        'Аккум. перфоратор WORTEX CRH 1822 в чем. XLT SET БЕСЩЕТ., 18 В, 2.6 Дж, 22 мм',
        'Wortex',
      ),
    ).toEqual(['TOOL battery:wortex-all1', 'TOOL sds:plus']);
    expect(
      tags(
        'Аккумулятор WORTEX CBL 1840-1 18.0 В, 4.0 А*ч, Li-Ion ALL1 XLT',
        'Wortex',
      ),
    ).toEqual(['PART battery:wortex-all1']);
    expect(
      tags(
        'Набор аккумулятор 2х4 А*ч и зарядное устройство 2х4 А BULL XLTpro',
        'BULL',
      ),
    ).toEqual(['PART battery:bull-xltpro']);
  });

  it('does not mistake a cordless tool for a battery', () => {
    expect(
      tags(
        'Аккумуляторная ударная дрель-шуруповерт MAKITA LXT DHP486Z',
        'MAKITA',
      ),
    ).toContain('TOOL battery:makita-lxt');
    expect(
      batteryPlatform({ name: 'Аккумулятор 12 В', brandName: 'Noname' }),
    ).toBeNull();
  });

  it('pairs angle grinders with discs of their diameter on a 22.2 mm arbor', () => {
    expect(
      tags(
        'Одноручная углошлифмашина WORTEX AG 1209-3 в кор. 900 Вт, 125 мм, 11000 об/мин',
        'Wortex',
      ),
    ).toEqual(['TOOL disc:125']);
    // Makita: the model is the diameter.
    expect(
      tags('Одноручная углошлифмашина MAKITA GA 5040 C в кор.', 'MAKITA'),
    ).toEqual(['TOOL disc:125']);
    expect(
      tags('Двуручная углошлифмашина MAKITA GA 9050 в кор.', 'MAKITA'),
    ).toEqual(['TOOL disc:230']);
    expect(
      tags('Круг отрезной 125х1.0x22.2 мм для металла и нерж. стали GEPARD'),
    ).toEqual(['PART disc:125']);
    expect(tags('Круг лепестковый 125х22мм P100 плоский ВОЛАТ')).toEqual([
      'PART disc:125',
    ]);
    expect(
      tags('Алмазный круг 125х22 мм универс. Turbo STARTUL STANDART'),
    ).toEqual(['PART disc:125']);
    // A 16 mm arbor is a bench grinder's, not an angle grinder's.
    expect(tags('Круг лепестковый зачистной 125x25x16мм (Grit 150)')).toEqual(
      [],
    );
    // Accessories for a grinder are not grinders.
    expect(
      tags('Стойка для УШМ (Ø115,125мм, высота 260мм, ход зажима 0-73мм)'),
    ).toEqual([]);
    expect(
      tags(
        'Кожух универсальный закрытого типа 125 мм. для УШМ MAKITA',
        'MAKITA',
      ),
    ).toEqual([]);
  });

  it('pairs rotary hammers with SDS bits — stated, by capacity or by spec', () => {
    expect(
      tags(
        'Перфоратор WORTEX RH 3231-1 в чем. + (2 зубила, 3 сверла) 1000 Вт, 4.8 Дж, 32 мм, 2 режима, SDS-plus',
        'Wortex',
      ),
    ).toEqual(['TOOL sds:plus']);
    expect(
      tags(
        'Перфоратор WORTEX RH 2427 в кор. + набор буров 700 Вт, 1.5 Дж, 18 мм',
        'Wortex',
      ),
    ).toEqual(['TOOL sds:plus']);
    expect(
      tags('Перфоратор MAKITA HR 5212 C в чем.', 'MAKITA', {
        'tip-patrona': 'SDS-max',
      }),
    ).toEqual(['TOOL sds:max']);
    expect(tags('Перфоратор MAKITA HR 2470 в чем.', 'MAKITA')).toEqual([]);
    expect(tags('8х150х210 мм бур (сверло) SDS-plus QUADRO-X ВОЛАТ')).toEqual([
      'PART sds:plus',
    ]);
    expect(tags('Пиковое зубило SDS-plus 250мм BOSCH')).toEqual([
      'PART sds:plus',
    ]);
  });

  it('pairs circular saws with blades of their diameter', () => {
    expect(
      tags(
        'Циркулярная пила WORTEX CS 1915 в кор. 1500 Вт, 190 мм, до 67 мм',
        'Wortex',
      ),
    ).toEqual(['TOOL sawblade:190']);
    expect(
      tags('Диск пильный 190х30/20/16 мм 24 зуб. по дереву ВОЛАТ'),
    ).toEqual(['PART sawblade:190']);
  });

  it('pairs screwdrivers with 1/4" bits, not with socket bits', () => {
    expect(tags("Бита TORX T25 1/4''х25мм (25шт./комп.)")).toEqual([
      'PART hex:1/4',
    ]);
    expect(
      tags('Набор бит (28 шт) с магнитным адаптером MAKITA', 'MAKITA'),
    ).toEqual(['PART hex:1/4']);
    expect(
      tags('Licota BHE102580 Бита 1/4" шестигранная H8 25 мм', 'Licota'),
    ).toEqual(['PART hex:1/4']);
    expect(
      tags('Вставка (бита) торцевая 1/2", Spline, M10, L = 55 мм KING TONY'),
    ).toEqual([]);
    expect(tags('Набор отверток реверсивных телескопических с битами')).toEqual(
      [],
    );
  });

  it('titles groups for both sides', () => {
    expect(fitmentTitles('disc:125')).toEqual({
      parts: 'Круги и диски 125 мм',
      tools: 'Болгарки (УШМ) 125 мм',
    });
    expect(fitmentTitles('battery:makita-lxt').parts).toBe(
      'Аккумуляторы и зарядные Makita LXT 18 В',
    );
  });
});
