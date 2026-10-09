import {
  canonicalRootFor,
  canonicalRoots,
  isPlaceholderCategory,
  normalizeCategoryName,
} from './taxonomy';

describe('canonicalRootFor', () => {
  // Every pair below is two real root categories of the production catalogue
  // that hold the same department under different supplier names.
  it.each([
    ['Электроинструменты BULL, MAKITA, WORTEX, ФИОЛЕНТ', 'Электроинструмент'],
    ['Пневматика', 'Пневматический инструмент'],
    ['Садовый инструмент', 'Садовая техника, оснастка и принадлежности'],
    ['Специальный инструмент', 'Наборы инструментов и специнструмент'],
    [
      'Очистители (мойки) высокого давления',
      'Моечное и уборочное оборудование',
    ],
    ['Нагреватели и осушители воздуха', 'Климатическое оборудование'],
    ['Освещение LED', 'Электротехническая продукция'],
  ])('merges "%s" into "%s"', (supplier, canonical) => {
    expect(canonicalRootFor(supplier)).toBe(canonical);
  });

  it('ignores case and spacing', () => {
    expect(canonicalRootFor('  ПНЕВМАТИКА ')).toBe('Пневматический инструмент');
    expect(
      canonicalRootFor('электроинструменты  BULL,MAKITA, WORTEX, ФИОЛЕНТ'),
    ).toBe('Электроинструмент');
  });

  it('leaves a canonical root alone', () => {
    for (const root of canonicalRoots()) {
      expect(canonicalRootFor(root)).toBeUndefined();
    }
  });

  // The table is deliberately incomplete: anything needing a judgement call is
  // reported for a human instead of merged. These are the open questions.
  it.each([
    'Оборудование',
    'Аксессуары',
    'Пневматическое и гидравлическое оборудование',
    'Автохимия и автокосметика',
    'Компрессоры',
    'Металлическая мебель',
  ])('does not guess about "%s"', (name) => {
    expect(canonicalRootFor(name)).toBeUndefined();
  });

  it('never maps a name onto itself', () => {
    for (const root of canonicalRoots()) {
      expect(normalizeCategoryName(canonicalRootFor(root) ?? '')).not.toBe(
        normalizeCategoryName(root),
      );
    }
  });
});

describe('isPlaceholderCategory', () => {
  // "!!ПУСТО!!" is a real root of the production catalogue, with 316 products
  // attached directly to it.
  it.each([
    '!!ПУСТО!!',
    '!ПУСТО!',
    'Пусто',
    '---',
    'н/д',
    'не указано',
    'Без категории',
    'Uncategorized',
  ])('treats "%s" as a placeholder', (name) => {
    expect(isPlaceholderCategory(name)).toBe(true);
  });

  // A product is on sale *and* a drill. "Акция" is what `onSale` answers.
  it.each(['Акция', 'Акции', 'Распродажа', 'Новинки', 'Хиты продаж', 'Услуги'])(
    'treats "%s" as a merchandising tag, not a department',
    (name) => {
      expect(isPlaceholderCategory(name)).toBe(true);
    },
  );

  it('treats an empty name as a placeholder', () => {
    expect(isPlaceholderCategory('')).toBe(true);
    expect(isPlaceholderCategory('   ')).toBe(true);
  });

  it.each([
    'Электроинструмент',
    'Ручной инструмент',
    'Прочее',
    'Аксессуары',
    'Хозтовары',
    'Крепеж',
    'Акционерное оборудование',
    'Услуги по ремонту инструмента',
  ])('leaves the real department "%s" alone', (name) => {
    expect(isPlaceholderCategory(name)).toBe(false);
  });
});

describe('normalizeCategoryName', () => {
  it('folds ё, case and whitespace', () => {
    expect(normalizeCategoryName('Крепёж')).toBe(
      normalizeCategoryName('КРЕПЕЖ'),
    );
    expect(normalizeCategoryName('А ,  Б')).toBe('а, б');
  });

  it('survives a non-breaking space', () => {
    expect(normalizeCategoryName('Ручной инструмент')).toBe(
      'ручной инструмент',
    );
  });
});
