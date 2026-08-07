import {
  DEFAULT_EXCLUDE_REGEX,
  isAllowedThToolsCategory,
} from './th-tools-source.parser';

const withDefaults = (breadcrumbs: string[]) =>
  isAllowedThToolsCategory(breadcrumbs, { exclude: DEFAULT_EXCLUDE_REGEX });

describe('isAllowedThToolsCategory (default rules)', () => {
  it.each([
    ['Ручной инструмент', 'Металлообработка', 'Шарошки'],
    ['Ручной инструмент', 'Головки торцевые'],
    ['Электроинструмент', 'Перфораторы'],
    ['Оборудование', 'Сварочное оборудование', 'Сварочные маски'],
    ['Пневматика', 'Гайковёрты'],
    ['Специальный инструмент'],
    ['Компрессоры'],
    ['Генераторы'],
    ['Освещение LED'],
  ])('keeps %s', (...breadcrumbs) => {
    expect(withDefaults(breadcrumbs)).toBe(true);
  });

  it.each([
    ['Косметика, уход', 'Мыло'],
    ['Косметика, уход', 'Заколки'],
    ['Аксессуары', 'Автолампы', 'Philips'],
    ['Аксессуары', 'Автохимия и косметика'],
    ['Аксессуары', 'Уход за авто'],
    ['Аксессуары', 'Щётки стеклоочистителей'],
    ['Аксессуары', 'Ароматизаторы'],
    ['Аксессуары', 'Антенны'],
    ['Аксессуары', 'Брелоки'],
    ['Аксессуары', 'Ковры напольные'],
    ['Аксессуары', 'Кресла детские'],
    ['Аксессуары', 'Очки для чтения'],
    ['Аксессуары', 'Помощь водителю'],
    ['Аксессуары', 'Внешний тюнинг'],
    ['Аксессуары', 'Внутрисалонные'],
    ['Велотехника', 'Насосы'],
    ['Дача, отдых и развлечения', 'Мангалы'],
  ])('drops %s', (...breadcrumbs) => {
    expect(withDefaults(breadcrumbs)).toBe(false);
  });

  it('keeps the on-topic parts of "Аксессуары"', () => {
    // Blanket-excluding the section would have dropped exactly the things we
    // want: measuring tools and protective workwear (welding masks live here).
    expect(withDefaults(['Аксессуары', 'Измерительные приборы'])).toBe(true);
    expect(withDefaults(['Аксессуары', 'Спецодежда, защита'])).toBe(true);
    expect(withDefaults(['Аксессуары', 'Запчасти, крепёж'])).toBe(true);
    expect(withDefaults(['Аксессуары', 'Электротовары'])).toBe(true);
  });

  it('handles both "щётки" and "щетки"', () => {
    expect(withDefaults(['Аксессуары', 'Щетки стеклоочистителей'])).toBe(false);
  });
});

describe('isAllowedThToolsCategory (configuration)', () => {
  it('allows everything when no patterns are set', () => {
    expect(isAllowedThToolsCategory(['Косметика, уход'], {})).toBe(true);
  });

  it('applies an include filter as a whitelist', () => {
    const patterns = { include: 'инструмент' };
    expect(isAllowedThToolsCategory(['Ручной инструмент'], patterns)).toBe(
      true,
    );
    expect(isAllowedThToolsCategory(['Компрессоры'], patterns)).toBe(false);
  });

  it('lets exclude win over include', () => {
    expect(
      isAllowedThToolsCategory(['Аксессуары', 'Автолампы'], {
        include: 'аксессуары',
        exclude: 'автоламп',
      }),
    ).toBe(false);
  });

  it('drops products that have no breadcrumbs when an include filter is set', () => {
    expect(isAllowedThToolsCategory([], { include: 'инструмент' })).toBe(false);
  });
});
