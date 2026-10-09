/**
 * Canonical top-level taxonomy.
 *
 * Every supplier names its own departments, and `CategoryTreeService` faithfully
 * builds whatever it is given — so the catalogue grew **52 root categories**,
 * half of them the same department under a different name:
 *
 *     Электроинструмент        ↔ Электроинструменты BULL, MAKITA, WORTEX, ФИОЛЕНТ
 *     Пневматика               ↔ Пневматический инструмент
 *     Садовый инструмент       ↔ Садовая техника, оснастка и принадлежности
 *     Специальный инструмент   ↔ Наборы инструментов и специнструмент
 *
 * A customer browsing "Электроинструмент" saw one supplier's products and had
 * no way to know the other supplier's sat in a sibling root. Unifying the roots
 * is what makes a selection source-independent.
 *
 * **Only unambiguous synonyms are listed here.** The project treats an
 * incorrect merge the same way it treats an incorrect product merge — expensive
 * to unpick — so anything requiring a judgement call (is "Оборудование" a
 * department or a catch-all? does "Автохимия" belong under "Автотовары"?) is
 * deliberately absent and gets reported for a human instead. Add an entry here
 * once that call has been made; the normalizer picks it up on its next run.
 */

/**
 * `supplier root name` → `canonical root name`, both as the suppliers spell
 * them. Matched on the normalized name (see `normalizeCategoryName`), so case
 * and spacing do not matter.
 *
 * The target must be a name that already exists in the catalogue as a root —
 * the normalizer merges into it and never invents a department of its own.
 */
const ROOT_SYNONYMS: Record<string, string> = {
  'электроинструменты bull, makita, wortex, фиолент': 'Электроинструмент',
  электроинструменты: 'Электроинструмент',
  пневматика: 'Пневматический инструмент',
  'садовый инструмент': 'Садовая техника, оснастка и принадлежности',
  'садовая техника': 'Садовая техника, оснастка и принадлежности',
  'специальный инструмент': 'Наборы инструментов и специнструмент',
  специнструмент: 'Наборы инструментов и специнструмент',
  'очистители (мойки) высокого давления': 'Моечное и уборочное оборудование',
  'мойки высокого давления': 'Моечное и уборочное оборудование',
  'нагреватели и осушители воздуха': 'Климатическое оборудование',
  'освещение led': 'Электротехническая продукция',
  освещение: 'Электротехническая продукция',
  сиз: 'Средства индивидуальной защиты и спецодежда',
  спецодежда: 'Средства индивидуальной защиты и спецодежда',
  'спецодежда и сиз': 'Средства индивидуальной защиты и спецодежда',
};

/**
 * Names that are not a department at all.
 *
 * Two kinds, and both really are in the production catalogue as roots:
 *  - a supplier's placeholder for "this product has no category" — `!!ПУСТО!!`
 *    had **316 products** attached directly to it;
 *  - a merchandising tag masquerading as taxonomy — `Акция`, `Услуги`.
 *    A product is on sale *and* a drill; "Акция" is what `onSale` is for.
 *
 * Their products belong in the unsorted category, where the admin catalogue
 * tools can see and place them, rather than in a root the storefront lists.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^!+\s*пусто\s*!+$/i,
  /^пусто$/i,
  /^-+$/,
  /^н\/?д$/i,
  /^не\s*указан[ао]?$/i,
  /^без\s+категории$/i,
  /^uncategorized$/i,
  /^акци[яи]$/i,
  /^распродажа$/i,
  /^новинки$/i,
  /^хиты?\s+продаж$/i,
  /^услуги$/i,
  /^товар\s+дня$/i,
];

/**
 * Normalized form used for matching: lowercase, `ё` folded, whitespace and
 * punctuation collapsed. `Электроинструменты  BULL,MAKITA` and
 * `электроинструменты bull, makita` are the same key.
 */
export function normalizeCategoryName(name: string): string {
  return (name || '')
    .replace(/\u00a0/g, ' ')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical root this name should be merged into, or `undefined` when the name
 * is already canonical (or is a judgement call left to a human).
 */
export function canonicalRootFor(name: string): string | undefined {
  const target = ROOT_SYNONYMS[normalizeCategoryName(name)];
  if (!target) return undefined;
  // A name that maps to itself is canonical, not a duplicate.
  return normalizeCategoryName(target) === normalizeCategoryName(name)
    ? undefined
    : target;
}

/** Whether this category name is a placeholder or a merchandising tag. */
export function isPlaceholderCategory(name: string): boolean {
  const normalized = normalizeCategoryName(name);
  if (!normalized) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Every canonical root referenced by the synonym table, for the admin report. */
export function canonicalRoots(): string[] {
  return [...new Set(Object.values(ROOT_SYNONYMS))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );
}
