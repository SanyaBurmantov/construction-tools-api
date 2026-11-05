import {
  DEFAULT_EXCLUDE_REGEX,
  isAllowedThToolsCategory,
} from './th-tools-source.parser';

const withDefaults = (breadcrumbs: string[]) =>
  isAllowedThToolsCategory(breadcrumbs, { exclude: DEFAULT_EXCLUDE_REGEX });

describe('isAllowedThToolsCategory (default rules)', () => {
  // Owner, 2026-11-05: the shop sells everything the supplier carries. The
  // old exclude list kept ~5k th-tool.by products out of the catalogue.
  it.each([
    ['Ручной инструмент', 'Металлообработка', 'Шарошки'],
    ['Электроинструмент', 'Перфораторы'],
    ['Оборудование', 'Сварочное оборудование', 'Сварочные маски'],
    ['Косметика, уход', 'Мыло'],
    ['Аксессуары', 'Автохимия и косметика', 'Герметики'],
    ['Аксессуары', 'Внутрисалонные'],
    ['Аксессуары', 'Брелоки'],
    ['Велотехника'],
    ['Дача, отдых и развлечения', 'Садовый инструмент', 'Топоры'],
    [],
  ])('keeps %s', (...breadcrumbs) => {
    expect(withDefaults(breadcrumbs)).toBe(true);
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
