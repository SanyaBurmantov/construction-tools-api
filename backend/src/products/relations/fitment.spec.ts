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
    ).toEqual(['TOOL battery:makita-lxt', 'TOOL hex:1/4', 'TOOL hexshank:1/4']);
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
    ).toEqual(['TOOL disc:125', 'TOOL spindle:M14']);
    // Makita: the model is the diameter.
    expect(
      tags('Одноручная углошлифмашина MAKITA GA 5040 C в кор.', 'MAKITA'),
    ).toEqual(['TOOL disc:125', 'TOOL spindle:M14']);
    expect(
      tags('Двуручная углошлифмашина MAKITA GA 9050 в кор.', 'MAKITA'),
    ).toEqual(['TOOL disc:230', 'TOOL spindle:M14']);
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
    // Makita's HR models: 24xx–28xx SDS-plus, 40xx–52xx SDS-max.
    expect(tags('Перфоратор MAKITA HR 2470 в чем.', 'MAKITA')).toEqual([
      'TOOL sds:plus',
    ]);
    expect(tags('8х150х210 мм бур (сверло) SDS-plus QUADRO-X ВОЛАТ')).toEqual([
      'PART sds:plus',
      'PART hole:8',
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
      'PART slot:T25',
    ]);
    expect(
      tags('Набор бит (28 шт) с магнитным адаптером MAKITA', 'MAKITA'),
    ).toEqual(['PART hex:1/4']);
    expect(
      tags('Licota BHE102580 Бита 1/4" шестигранная H8 25 мм', 'Licota'),
    ).toEqual(['PART hex:1/4']);
    expect(
      tags('Вставка (бита) торцевая 1/2", Spline, M10, L = 55 мм KING TONY'),
    ).toEqual(['PART drive:1/2']);
    expect(tags('Набор отверток реверсивных телескопических с битами')).toEqual(
      [],
    );
  });

  it('pairs ratchets and wrenches with sockets of the same drive', () => {
    expect(tags('Трещотка 1/2" 45 зубьев 255мм ВОЛАТ')).toEqual([
      'TOOL drive:1/2',
    ]);
    expect(
      tags('Ключ динамометрический JTC-4935 (1/2", 10-100 Нм, 405 мм)'),
    ).toEqual(['TOOL drive:1/2']);
    expect(tags("Вороток Т-образный 500мм 3/4''")).toEqual(['TOOL drive:3/4']);
    expect(
      tags('Головка торцевая глубокая шестигранная 1/2" 13 мм TOLSEN TT16563'),
    ).toEqual(['PART drive:1/2']);
    expect(tags("Головка 3/8'', 14мм (6гр.)")).toEqual(['PART drive:3/8']);
    // An adapter has two drives; a trimmer head is not a socket.
    expect(tags("Вороток Г-образный двухсторонний 450мм 3/4''х1/2''")).toEqual(
      [],
    );
    expect(tags('Головка триммерная WORTEX ТН 3018 леска 1/2"')).toEqual([]);
  });

  it('pairs bolts and screws with nuts and washers of the thread', () => {
    expect(
      tags(
        'Болт М10х80 мм шестигр., цинк, кл.пр. 5.8, DIN 933 (5 кг) STARFIX',
        'STARFIX',
      ),
    ).toEqual(['TOOL thread:M10']);
    expect(
      tags(
        'Гайка М10 со стопорным кольцом, цинк, DIN 985 (10 шт в зип-локе) STARFIX',
      ),
    ).toEqual(['PART thread:M10']);
    expect(
      tags('Шайба М10 плоская, цинк, DIN 125 (100 шт в пласт. конт.) STARFIX'),
    ).toEqual(['PART thread:M10']);
    expect(tags('Гайковерт пневматический 1/2" 680 Нм')).not.toContain(
      'PART thread:M680',
    );
    expect(tags('Гайка М5/8 врезная, цинк, DIN 1624')).toEqual([]);
  });

  it('pairs anchors and plugs with masonry bits of the hole they need', () => {
    expect(
      tags('Дюбель распорный 10х80 мм тип N, нейлон (250 шт в пакете) STARFIX'),
    ).toEqual(['TOOL hole:10']);
    expect(tags('Анкер клиновой М10х120 мм STARFIX')).toEqual(['TOOL hole:10']);
    // A drop-in or sleeve anchor: the second size is the hole.
    expect(
      tags('Анкер забиваемый М10х12х40 мм (4 шт в зип-локе) STARFIX'),
    ).toEqual(['TOOL hole:12']);
    expect(tags('Анкер с гайкой двухраспорный М6х10х100 мм STARFIX')).toEqual([
      'TOOL hole:10',
    ]);
    expect(tags('10х150х210 мм бур (сверло) SDS-plus GEPARD')).toEqual([
      'PART sds:plus',
      'PART hole:10',
    ]);
    expect(tags('Сверло по бетону ц/х 10х80х120 мм CYL-1 BOSCH')).toEqual([
      'PART hole:10',
    ]);
    // A metal drill is not for an anchor.
    expect(tags('Сверло по металлу ц/х 10.0х87х133 мм HSS-Co GEPARD')).toEqual(
      [],
    );
  });

  it('pairs screws with bits of their recess, stated or by standard', () => {
    expect(
      tags(
        'Шуруп конструкционный 6.0х300 мм по дереву, потай, T30 (500 шт в коробе) STARFIX',
      ),
    ).toEqual(['TOOL slot:T30']);
    expect(
      tags('Саморез 3.5х25 мм для монтажа ГКЛ к дереву, фосфат (5 кг) STARFIX'),
    ).toEqual(['TOOL slot:PH2']);
    expect(
      tags(
        'Шуруп 4.2х19 мм полусф. головка, белый цинк, острый, DIN 7981 (100 шт в зип-локе) STARFIX',
      ),
    ).toEqual(['TOOL slot:PH2']);
    expect(
      tags(
        'Винт М3х12 мм полусфера, нерж.сталь (А2), DIN 7985 (50 шт в зип-локе) STARFIX',
      ),
    ).toEqual(['TOOL thread:M3', 'TOOL slot:PH1']);
    // Hex head roofing screws name no recess: no guess.
    expect(
      tags(
        'Саморез кровельный 4.8х35 мм цинк, шайба с прокл., PT1 (200 шт) STARFIX',
      ),
    ).toEqual([]);
    expect(tags('Бита TORX JTC-1132525 (Т25х25 мм, 1/4")')).toEqual([
      'PART hex:1/4',
      'PART slot:T25',
    ]);
    expect(
      tags('Набор бит (3 шт; РH1/РH2/РH3; 25 мм) MAKITA', 'MAKITA'),
    ).toEqual([
      'PART hex:1/4',
      'PART slot:PH1',
      'PART slot:PH2',
      'PART slot:PH3',
    ]);
  });

  it('regressions from the review', () => {
    // «10пр.», «7шт» are not TORX sizes.
    expect(
      tags('Набор бит 10пр. в пластиковом футляре Forsage F-2101'),
    ).toEqual(['PART hex:1/4']);
    expect(tags('Набор бит 7шт смеш. Max Grip')).toEqual(['PART hex:1/4']);
    // A kit of cordless tools is a tool, not a battery.
    expect(
      tags('Набор аккумуляторного инструмента MAKITA DLX2283 LXT', 'MAKITA'),
    ).toEqual(['TOOL battery:makita-lxt']);
    expect(tags('Машина шлифовальная угловая 125 мм, 1100 Вт ЗУБР')).toEqual([
      'TOOL disc:125',
      'TOOL spindle:M14',
    ]);
  });

  it('widened 2026-11: XGT and model-coded grinders, M14 accessories', () => {
    // 40 V XGT models carry no size in the code; listed ones only.
    expect(
      tags('Аккум. углошлифмашина MAKITA XGT GA 013 GZ', 'MAKITA'),
    ).toEqual(['TOOL battery:makita-xgt', 'TOOL disc:125', 'TOOL spindle:M14']);
    expect(
      tags('Аккум. углошлифмашина MAKITA XGT GA 012 GM 201', 'MAKITA'),
    ).toContain('TOOL disc:115');
    expect(
      tags('Аккум. углошлифмашина MAKITA XGT GA038GZ в кор.', 'MAKITA'),
    ).toContain('TOOL disc:230');
    expect(
      tags('Одноручная углошлифмашина MAKITA 9558 HNR в кор.', 'MAKITA'),
    ).toEqual(['TOOL disc:125', 'TOOL spindle:M14']);
    expect(
      tags(
        'Одноручная углошлифмашина ФИОЛЕНТ МШУ 13-9-125 Э в кор.',
        'ФИОЛЕНТ',
      ),
    ).toEqual(['TOOL disc:125', 'TOOL spindle:M14']);
    // «Углошлифовальная» is not «углов…»; the size can be in a spec only.
    expect(
      tags(
        'Углошлифовальная машина (УШМ, Болгарка) Milwaukee 4933451222, AGV 10-125 EK, 125 мм',
        'Milwaukee',
        { 'rezba-shpindelya': 'M14', 'diametr-diska': '125' },
      ),
    ).toEqual(['TOOL disc:125', 'TOOL spindle:M14']);
    expect(
      tags(
        'Машина углошлифовальнаяThorvik BG2095 аккумуляторная, 20В, 9500 об/мин',
        'Thorvik',
        { 'diametr-diska': '125 мм' },
      ),
    ).toEqual(['TOOL disc:125', 'TOOL spindle:M14']);
    // An unknown XGT model gets nothing rather than a guess.
    expect(
      tags('Аккум. углошлифмашина MAKITA XGT GA 099 GZ', 'MAKITA'),
    ).toEqual(['TOOL battery:makita-xgt']);
    // Wire brushes, backing pads, flap discs and crowns stating М14.
    expect(tags('Кордщетка чашеобразная латунная для УШМ 125мм (М14)')).toEqual(
      ['PART spindle:M14'],
    );
    expect(
      tags('Щетка дисковая гофрированная 125мм/M14 GEPARD (GP0892-125)'),
    ).toEqual(['PART spindle:M14']);
    expect(
      tags('Тарелка опорная с Velcro фиксацией для УШМ (125мм, М14)'),
    ).toEqual(['PART spindle:M14']);
    expect(tags('Круг лепестковый зачистной 115х20мм M14 (Grit 60)')).toEqual([
      'PART spindle:M14',
    ]);
    expect(
      tags('Коронка алмазная d 32мм M14 керамогранит GEPARD (GP2075-32)'),
    ).toEqual(['PART spindle:M14']);
    // A disc brush without «М14» may have a 22.2 bore; mixer paddles, spark
    // plug threads and polisher pads are not grinder accessories.
    expect(
      tags('Кордщетка дисковая стальная витая для УШМ 125мм, в блистере'),
    ).toEqual([]);
    expect(tags('Миксер для смесей 120х600мм M14 GEPARD (GP4005-01)')).toEqual(
      [],
    );
    expect(
      tags(
        'Набор для восстановления резьбы M14x1.25 15 предметов Thorvik TRIS14125',
      ),
    ).toEqual([]);
    expect(
      tags(
        'Подошва для полировальных дисков MIRKA 8297801011 мягкая, 125 мм, М14',
      ),
    ).toEqual([]);
  });

  it('widened 2026-11: Makita hammers by model', () => {
    expect(tags('Перфоратор MAKITA HR 2811 F в чем.', 'MAKITA')).toEqual([
      'TOOL sds:plus',
    ]);
    expect(
      tags('Аккум. перфоратор MAKITA LXT DHR 242 Z в кор.', 'MAKITA'),
    ).toEqual(['TOOL battery:makita-lxt', 'TOOL sds:plus']);
    expect(tags('Перфоратор MAKITA HR 4013 C в чем.', 'MAKITA')).toEqual([
      'TOOL sds:max',
    ]);
    // XGT HR0xxG: no table entry, no guess.
    expect(
      tags('Аккум. перфоратор MAKITA XGT HR 007 GZ в кор.', 'MAKITA'),
    ).toEqual(['TOOL battery:makita-xgt']);
  });

  it('widened 2026-11: saws by blade size, model or spec; blades by D x bore', () => {
    expect(
      tags(
        'Циркулярная пила BULL KS 1601 в кор. 1300 Вт, 165х20 мм, до 55 мм',
        'BULL',
      ),
    ).toEqual(['TOOL sawblade:165']);
    expect(
      tags(
        'Пила циркулярная аккумуляторная RUNTEC TECHNIC RT-CS1000T (190*30 мм, 20 В, 2*4 Ач, 1000 Вт)',
        'RUNTEC',
      ),
    ).toEqual(['TOOL sawblade:190']);
    expect(tags('Циркулярная пила MAKITA HS 7601 в кор.', 'MAKITA')).toEqual([
      'TOOL sawblade:190',
    ]);
    expect(tags('Циркулярная пила MAKITA 5008 MG в кор.', 'MAKITA')).toEqual([
      'TOOL sawblade:210',
    ]);
    expect(
      tags('Аккум. циркулярная пила MAKITA LXT DHS 680 Z в кор.', 'MAKITA'),
    ).toEqual(['TOOL battery:makita-lxt', 'TOOL sawblade:165']);
    // Two sizes in the name (blade and cut width): the spec decides.
    expect(
      tags(
        'Торцовочная пила WORTEX MS 2116 L в кор. 1500 Вт, 210 мм, глуб. до 60 мм, шир. до 115 мм, лазер',
        'Wortex',
        { 'parametry-diska~mm': '210х30х24Т' },
      ),
    ).toEqual(['TOOL sawblade:210']);
    // A range in the spec is no diameter.
    expect(
      tags(
        'Аккум. циркулярная пила по металлу MAKITA LXT DCS 553 Z в кор.',
        'MAKITA',
        {
          'diametr-diska': '136 - 150 мм',
        },
      ),
    ).toEqual(['TOOL battery:makita-lxt']);
    // Unconfirmed XGT saw: no guess.
    expect(
      tags('Аккум. циркулярная пила MAKITA XGT HS 004 GZ в кор.', 'MAKITA'),
    ).toEqual(['TOOL battery:makita-xgt']);
    expect(
      tags(
        'Диск пильный универсальный STANDART 260X30X2.6X100T MAKITA',
        'MAKITA',
      ),
    ).toEqual(['PART sawblade:260']);
    expect(
      tags('Диск пильный 190х30x1.6/1x40T по дереву MAKITA', 'MAKITA'),
    ).toEqual(['PART sawblade:190']);
    expect(tags('Диск универсальный 165х2.2х20, 60T MAKITA', 'MAKITA')).toEqual(
      ['PART sawblade:165'],
    );
    expect(tags('Диск 190х30 24 зуба OPTILINE (Bosch)', 'Bosch')).toEqual([
      'PART sawblade:190',
    ]);
    // A brush-cutter blade is not a circular-saw blade.
    expect(
      tags('Диск пильный 250х25,4 мм 40 зуб. для кустарника MAKITA', 'MAKITA'),
    ).toEqual([]);
  });

  it('widened 2026-11: chains by pitch, gauge and drive links', () => {
    expect(
      tags(
        'Бензопила ECO CSP-166 шина 40 см (16"), 3/8" LP, 1.3 мм, 57 зв.',
        'ECO',
      ),
    ).toEqual(['TOOL chain:3/8LP-1.3-57']);
    expect(
      tags(
        'Цепь 40 см 16" 3/8" LP 1.3 мм 57 зв. 38LTA (в блистере) ECO',
        'ECO',
      ),
    ).toEqual(['PART chain:3/8LP-1.3-57']);
    // Links from the spec; «3/8» with a 1.1 mm gauge exists only as LP.
    expect(
      tags(
        'Аккум. пила цепная MAKITA LXT DUC 356 Z шина 35 см (14"), 3/8, 1.1 мм',
        'MAKITA',
        {
          'shag-cepi~dyujm': '38',
          'kolvo-zvenev~sht': '52',
          'shirina-paza~mm': '1.1',
        },
      ),
    ).toEqual(['TOOL battery:makita-lxt', 'TOOL chain:3/8LP-1.1-52']);
    expect(
      tags(
        'Цепь 35 см. 14", шаг3/8", паз 1,1мм, звеньев 52, 90PX MAKITA',
        'MAKITA',
        {
          'kolvo-zvenev': '52',
        },
      ),
    ).toEqual(['PART chain:3/8LP-1.1-52']);
    expect(
      tags(
        'Бензопила HDC HD-C361 шина 40 см (16"), 3/8", 1.6 мм, 60 зв.',
        'HDC Equipment',
      ),
    ).toEqual(['TOOL chain:3/8-1.6-60']);
    expect(
      tags('Цепь 45 см 18" 0.325" 1.5 мм 72 зв. 325TA (в блистере) ECO', 'ECO'),
    ).toEqual(['PART chain:.325-1.5-72']);
    // «3/8"» + 1.3 mm may be either profile; no links — no key; a bulk reel
    // and a welded chain are not saw chains; name and spec disagreeing — none.
    expect(
      tags(
        'Бензопила DGM GS-232 шина 40 см (16"), 3/8", 1.3 мм, 57 зв.',
        'DGM',
      ),
    ).toEqual([]);
    expect(
      tags(
        'Пила цепная электрическая MAKITA UC 4041 A шина 40 см (16"), 3/8" LP, 1.3 мм',
        'MAKITA',
      ),
    ).toEqual([]);
    expect(
      tags('Цепь 0.325" 1.5 мм 1840 зв. 325TA (бухта 30.4 м) ECO', 'ECO'),
    ).toEqual([]);
    expect(
      tags(
        'Цепь сварная короткозвенная, оцинк. М5 DIN 766 (бухта 30 м)',
        'STARFIX',
      ),
    ).toEqual([]);
    expect(
      tags(
        'Аккум. пила цепная MAKITA XGT UC015GZ01 шина 35 см (14"), 3/8, 1.1 мм',
        'MAKITA',
        { 'shag-cepi': '0.325', 'shirina-paza-shiny~mm': '1.1' },
      ),
    ).toEqual(['TOOL battery:makita-xgt']);
  });

  it('widened 2026-11: trimmer line by diameter', () => {
    expect(
      tags(
        'Триммер аккум. WORTEX TB 3018-1 ALL1 XLT SOLO 18В, шир.скаш.350 мм, леска 1.6 мм',
        'Wortex',
      ),
    ).toEqual(['TOOL battery:wortex-all1', 'TOOL line:1.6']);
    expect(
      tags('Триммер MAKITA UR 3501', 'MAKITA', {
        'maks-diametr-leski': '1.65 мм',
      }),
    ).toEqual(['TOOL line:1.6']);
    expect(
      tags(
        'Головка триммерная ECO GTP-TC40 леска ф 2.4 мм полуавт., блистер',
        'ECO',
      ),
    ).toEqual(['TOOL line:2.4']);
    expect(
      tags('Леска ф 2.4 мм х 87 м кругл. сеч. DUAL-CUT STARTUL GARDEN'),
    ).toEqual(['PART line:2.4']);
    expect(
      tags('Леска ф 1.65 мм х 15 м квадратн. сеч. STARTUL GARDEN'),
    ).toEqual(['PART line:1.6']);
    expect(tags('Леска ф 3.0 мм х 33 м "звездочка" STARTUL GARDEN')).toEqual([
      'PART line:3.0',
    ]);
    // «430 мм» is the cutting width, not the line.
    expect(
      tags('Мотокоса GUNTER MSG-435', 'GUNTER', {
        'diametr-rabochej-zony-leski': '430 мм',
      }),
    ).toEqual([]);
  });

  it('widened 2026-11: anchors by the drill size in the spec', () => {
    // A molly's name gives the screw; the hole is 11 mm.
    expect(
      tags(
        'Дюбель металлический для пустотелых конструкций 5х52 мм (4 шт в зип-локе) STARFIX',
        'STARFIX',
        {
          'diametr-sverleniya~mm': '11',
        },
      ),
    ).toEqual(['TOOL hole:11']);
    expect(
      tags(
        'Дюбель металлический для пустотелых конструкций 5х52 мм С-образный STARFIX',
        'STARFIX',
      ),
    ).toEqual([]);
    expect(
      tags('Анкер латунный(цанга) М10 (50 шт в карт. уп.) STARFIX', 'STARFIX', {
        'diametr-ankera-sverla~mm': '12',
      }),
    ).toEqual(['TOOL hole:12']);
    // A cable clip is named by the cable.
    expect(
      tags(
        'Дюбель-хомут для прямоугольного кабеля 8х5 мм белый (100 шт в пакете) STARFIX',
        'STARFIX',
        {
          'diametr-dyubelya-sverla~mm': '6',
        },
      ),
    ).toEqual(['TOOL hole:6']);
    // A plastic butterfly is named by its hole.
    expect(
      tags(
        'Дюбель для пустотелых конструкций (бабочка) 10х50 мм (200 шт в пакете) STARFIX',
        'STARFIX',
      ),
    ).toEqual(['TOOL hole:10']);
    // No drilled hole: powder-gun nails, self-drilling drywall plugs, toggles.
    expect(
      tags(
        'Дюбель-гвоздь для монт. пистолета 4.5х50 мм (1 кг в карт.уп.) STARFIX',
        'STARFIX',
      ),
    ).toEqual([]);
    expect(
      tags(
        'Дюбель пластмассовый для ГКЛ DRIVA 15х23 мм (500 шт в пакете) STARFIX',
        'STARFIX',
      ),
    ).toEqual([]);
    expect(
      tags(
        'Дюбель складной пружинный М8х100 мм полукольцо (150 шт в коробе) STARFIX',
        'STARFIX',
      ),
    ).toEqual([]);
  });

  it('widened 2026-11: impact wrenches take impact sockets only', () => {
    expect(
      tags(
        'Пневмогайковерт 1/2" 813Nm длинн. жало TOPTUL (KAAB1660)',
        'TOPTUL',
      ),
    ).toEqual(['TOOL impact:1/2']);
    expect(tags("1/2''Пневмогайковерт 860Нм", 'Rotake')).toEqual([
      'TOOL impact:1/2',
    ]);
    // The air inlet is not a second drive.
    expect(
      tags(
        "Пневмогайковерт ударный''Twin Hammer''с регулировкой 1/2''(720Hм,7500об/мин,6.3bar,236л/мин,штуцер 1/4'')",
        'FORCEKRAFT',
      ),
    ).toEqual(['TOOL impact:1/2']);
    expect(
      tags(
        'Гайковерт пневматический ударный KING TONY 33811-150, 1", 2033 Нм',
        'King Tony',
      ),
    ).toEqual(['TOOL impact:1']);
    expect(
      tags('Аккум. ударный гайковерт MAKITA CXT TW 160 DWAE в чем.', 'MAKITA', {
        'tip-patrona': 'Квадрат 38',
      }),
    ).toEqual(['TOOL battery:makita-cxt', 'TOOL impact:3/8']);
    // A pneumatic ratchet and a hand torque multiplier take ordinary sockets.
    expect(
      tags('Пневмогайковерт-трещотка 3/8" 54Nm TOPTUL (KAAF1204)', 'TOPTUL'),
    ).toEqual(['TOOL drive:3/8']);
    expect(
      tags(
        "Гайковерт ручной механический ROSSVIK РГ-64 (1'', 4800 Нм)",
        'ROSSVIK',
      ),
    ).toEqual(['TOOL drive:1']);
    // «1.1/2"» is a 1-1/2" drive; hydraulic wrenches get nothing.
    expect(
      tags(
        'Гайковерт NBTW-46L аккумуляторный NORGAU 057003146 (1.1/2", 1150-4500Nm)',
        'NORGAU',
      ),
    ).toEqual([]);
    expect(
      tags(
        'GARWIN INDUSTRIAL 540511-3 Гайковёрт гидравлический с приводным квадратом 1”; 436-4364 Нм',
        'GARWIN INDUSTRIAL',
      ),
    ).toEqual([]);
    expect(
      tags(
        'Головка торцевая ударная глубокая шестигранная 1/2", 12 мм KING TONY 443512M',
        'King Tony',
      ),
    ).toEqual(['PART drive:1/2', 'PART impact:1/2']);
    expect(tags("Головка-бита TORX ударная T55,1/2''", 'Forsage')).toEqual([
      'PART drive:1/2',
      'PART impact:1/2',
    ]);
    // A spec-only drive; a «1&1/2"» socket must not fall back to a spec «1/2"».
    expect(
      tags('Головка ударная CHICAGO PNEUMATIC S422M', 'Chicago Pneumatic', {
        'posadochnyj-razmer': '1/2"',
      }),
    ).toEqual(['PART drive:1/2', 'PART impact:1/2']);
    expect(
      tags(
        'Головка торцевая ударная шестигранная 1&1/2", 50 мм KING TONY 953550M',
        'King Tony',
        {
          'posadochnyj-razmer': '1/2"',
        },
      ),
    ).toEqual([]);
    // A spare part for a wrench is not a wrench.
    expect(
      tags('Направляющая к пневмогайковерту ST-55414', '', {
        'posadochnyj-razmer': '1/2"',
      }),
    ).toEqual([]);
  });

  it('widened 2026-11: impact drivers and 1/4" hex-shank drill bits', () => {
    expect(
      tags(
        'Винтоверт ударный аккумуляторный RUNTEC PRO RT-ED233 (1/4", 20В, 2*2Ач, 230 Нм)',
        'RUNTEC',
      ),
    ).toEqual(['TOOL hex:1/4', 'TOOL hexshank:1/4']);
    expect(
      tags(
        'Сверло по металлу Runtec RT-DS10, HSS-TiN 10 x 133 мм HEX 1/4"',
        'RUNTEC',
      ),
    ).toEqual(['PART hexshank:1/4']);
    expect(
      tags('Сверло по бетону 6х100мм шестигр. GEPARD (GP0226-100)', 'GEPARD', {
        'tip-hvostovika': 'Шестигранный 1/4"',
      }),
    ).toEqual(['PART hexshank:1/4', 'PART hole:6']);
    // A cylindrical shank, and a 1 1/4" core-bit thread, are not hex shanks.
    expect(tags('Сверло по металлу ц/х 10.0х87х133 мм HSS-Co GEPARD')).toEqual(
      [],
    );
    expect(
      tags(
        'Коронка алмазная d 63мм железобетон BULL, L450мм, 1 1/4", микроудар, сухое сверление',
        'BULL',
      ),
    ).toEqual([]);
  });

  it('titles groups for both sides', () => {
    expect(fitmentTitles('disc:125')).toEqual({
      parts: 'Круги и диски 125 мм',
      tools: 'Болгарки (УШМ) 125 мм',
    });
    expect(fitmentTitles('battery:makita-lxt').parts).toBe(
      'Аккумуляторы и зарядные Makita LXT 18 В',
    );
    expect(fitmentTitles('chain:3/8LP-1.3-57')).toEqual({
      parts: 'Цепи 3/8" LP, 1,3 мм, 57 зв.',
      tools: 'Цепные пилы под цепь 3/8" LP, 1,3 мм, 57 зв.',
    });
    expect(fitmentTitles('chain:.325-1.5-72').parts).toBe(
      'Цепи .325", 1,5 мм, 72 зв.',
    );
    expect(fitmentTitles('line:2.4').parts).toBe('Леска 2,4 мм');
    expect(fitmentTitles('impact:1/2').tools).toBe('Ударные гайковёрты 1/2"');
  });
});
