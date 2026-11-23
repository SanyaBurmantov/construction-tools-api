import { headNoun, namesDifferentKinds } from './item-kind';

/** Real titles from production (2026-11-23), one article each. */
describe('namesDifferentKinds', () => {
  it.each([
    [
      'Домкрат гидравлический профессиональный Forcekraft FK-F7205',
      'Расширитель гидравлический 8т (2,5-107мм)',
    ],
    [
      'Индикатор часового типа с магнитной стойкой (0-10мм, погрешность-0,01мм)',
      'Микрометр Forsage F-01729 в кейсе',
    ],
    [
      "Ключ динамометрический щелчкового типа ''Profi''19-110Нм 3/8''",
      'Трубогиб гидравлический вертикальный Forsage F-1202 (12т)',
    ],
    [
      'Набор головок коротких 15 пр. в ложементе (10,12-15,17,19,21,22,24, 27',
      'Набор бит RIBE c битодержателем 15пр. в металлическом кейсе Rock Force',
    ],
  ])('flags «%s» vs «%s»', (a, b) => {
    expect(namesDifferentKinds(a, b)).toBe(true);
  });

  it.each([
    // b2bit's two-word names against dukon's detailed ones.
    [
      'Набор ключей WorkPro WP222004',
      'Ключи 6-гранные 9шт в держателе WP222004 WORKPRO',
    ],
    [
      'Стамеска WorkPro WP243009',
      'Долото для высоких нагрузок 20мм WP243009 WORKPRO',
    ],
    [
      'Плоскогубцы WorkPro WP231085',
      'Пассатижи 200мм многофункциональные проф WP231085 WORKPRO',
    ],
    ['Набор бит WorkPro WP200513', 'Биты 31шт в боксе WP200513 WORKPRO'],
    // Word order and synonyms.
    [
      'Отрезной круг Bosch 150х2.5х22мм Expert for Metal 2608600382',
      'Круг отрезной 150х2.5x22.2 мм для металла Expert BOSCH',
    ],
    [
      'Алмазный круг 125х22 мм по камню сегмент. STANDARD FOR STONE BOSCH',
      'Алмазный диск Bosch 125-22.23-1.7 HPE 2.608.602.598',
    ],
    [
      'Угловая шлифмашина Milwaukee AGV 10-125 EK (4933451222)',
      'Углошлифовальная машина (УШМ, Болгарка) Milwaukee 4933451222, AGV 10-1',
    ],
    ['Шлифмашина Makita BO4566', 'Виброшлифмашина MAKITA BO 4566 в кор.'],
    [
      'Клещи для масляного фильтра с фиксатором Forsage F-639230',
      'Съемник масляного фильтра с фиксатором(55-115мм), в блистере',
    ],
    [
      'Стяжка пружин гидравлическая напольная (усилие стяжки до 1т',
      'Съемник пружин гидравлический напольный Rock Force RF-1500-4',
    ],
    [
      'Съемник трехлапый универсальный BaumAuto BM-03012-6',
      'Съемник трехлапый универсальный (Ø захвата 125мм, глубина 90мм)',
    ],
  ])('keeps «%s» and «%s» together', (a, b) => {
    expect(namesDifferentKinds(a, b)).toBe(false);
  });

  it('reads the noun after adjectives and packaging words', () => {
    expect(headNoun('Гидравлический домкрат 8т')).toBe('домкрат');
    expect(headNoun('Набор головок 1/2" 24 пр.')).toBe('головок');
    expect(headNoun('Bosch GSR 12V')).toBeNull();
  });
});
