/**
 * Which parsed characteristics are catalogue material, and which are not.
 *
 * Parsers used to mark every spec `filterable: true`, so a supplier's spec table
 * turned straight into facets — including "Штрихкод" (a different value for
 * every single product) and "Производитель" (a 200-character legal address).
 * A filter with as many options as there are products is not a filter.
 *
 * One module, three tiers, from strictest to softest:
 *
 * 1. **Supplier paperwork** (`isSupplierPaperworkSpec`) — «Поставщик»,
 *    «Импортер/Продавец», «Производитель» (a legal address), the supplier's
 *    internal «Код». Never a filter, and **never shown to customers**: who we
 *    buy from is internal, and "Импортер/Продавец: ООО «ТД Комплект»" next to
 *    our own name tells the customer someone else sells this. Kept in the
 *    database (and in admin) — it is still useful for matching and support.
 * 2. **Identity fields** (`isIdentitySpec`) — the above plus barcode, article,
 *    brand. Shown on the product page, never a filter, and admins cannot turn
 *    them into one. The storefront facet builder enforces this at read time
 *    too, so a legacy row with `filterable = true` stays invisible.
 * 3. **Off by default** (`isOffByDefaultSpec`) — weight and overall
 *    dimensions. Numeric, near-unique per product, and three suppliers spell
 *    them three ways («Вес», «Вес, кг», «Вес с упаковкой, кг»), so as checkbox
 *    facets they were three long useless lists. Created `filterable = false`,
 *    never switched on by the nightly normalizer, but an admin *may* turn one
 *    on in `/admin/specifications` — this tier is a default, not a ban.
 */

/**
 * Supplier/paperwork rows. Matched as substrings against the lowercased name,
 * so "Импортер/Продавец" and "Адрес производителя" are both covered.
 */
const SUPPLIER_PAPERWORK = [
  'поставщик',
  'импортер',
  'импортёр',
  'продавец',
  'производител', // «Производитель», «Адрес производителя»
  'изготовител',
  'уполномоченн', // «Уполномоченное лицо (организация)»
];

/**
 * The supplier's own item number: «Код», «Код поставщика», «Код товара». Only
 * as the whole name or its first word — «Кодовый замок» is a real property.
 */
const SUPPLIER_CODE = /^код(?=$|[\s,:(/.-])/;

/** Identity fields: one value per product — shown, but never a facet. */
const IDENTITY = [
  'штрих',
  'ean',
  'gtin',
  'артикул',
  'sku',
  'бренд',
  'brand',
  'торговая марка',
  'срок годности',
  'серийн',
  'дата изготовл',
  'гарантийный талон',
];

/** Cyrillic letters, for word boundaries `\b` does not understand. */
const LETTER = 'а-яёa-z';
/** «Вес», «Вес, кг», «Вес с упаковкой», «Масса нетто» — but not «Подвес». */
const WEIGHT = new RegExp(`(^|[^${LETTER}])(вес|масса)(?=$|[^${LETTER}])`);
/** «Габариты (ДхШхВ), см», «Размеры упаковки», «ДxШxВ». */
const DIMENSIONS =
  /габарит|размеры? упаковки|(^|[^а-яёa-z])д\s*[xх×*]\s*ш\s*[xх×*]\s*в/;

/**
 * A value this long is prose, not a facet. Catches the free-text rows suppliers
 * put in their spec tables without having to enumerate them.
 */
const MAX_FILTERABLE_VALUE_LENGTH = 60;

function normalize(name: string): string {
  return (name ?? '').trim().toLowerCase();
}

/** Tier 1: supplier paperwork — hidden from every public product payload. */
export function isSupplierPaperworkSpec(name: string): boolean {
  const normalized = normalize(name);
  if (!normalized) return false;
  // «Страна производителя» / «Страна-изготовитель» is consumer information
  // (and a perfectly good facet), not the manufacturer's legal address.
  if (normalized.startsWith('страна')) return false;
  return (
    SUPPLIER_PAPERWORK.some((needle) => normalized.includes(needle)) ||
    SUPPLIER_CODE.test(normalized)
  );
}

/** Tier 2: identity or paperwork — can never be a filter, not even by hand. */
export function isIdentitySpec(name: string): boolean {
  const normalized = normalize(name);
  if (!normalized) return true;
  return (
    isSupplierPaperworkSpec(normalized) ||
    IDENTITY.some((needle) => normalized.includes(needle))
  );
}

/** Tier 3: weight and overall dimensions — not a facet unless an admin says so. */
export function isOffByDefaultSpec(name: string): boolean {
  const normalized = normalize(name);
  return WEIGHT.test(normalized) || DIMENSIONS.test(normalized);
}

/**
 * Whether a characteristic should *start out* as a catalogue filter. Used when
 * a spec first appears in a category and by the automatic selections; an
 * admin's manual toggle is checked against `isIdentitySpec` only.
 */
export function shouldBeFilterable(name: string, value?: string): boolean {
  if (isIdentitySpec(name) || isOffByDefaultSpec(name)) return false;
  if (value && value.trim().length > MAX_FILTERABLE_VALUE_LENGTH) return false;
  return true;
}

/**
 * Lower is shown earlier. Identity rows (barcode, article, brand) and the
 * packaging numbers go to the bottom of a spec list: the product card shows
 * the first three, and those three should describe the tool, not its box.
 */
function displayRank(name: string): number {
  if (isIdentitySpec(name)) return 2;
  if (isOffByDefaultSpec(name)) return 1;
  return 0;
}

/**
 * The storefront's view of a product's characteristics: supplier paperwork
 * removed, consumer properties first. Stable — the supplier's order is kept
 * within each rank. Admin endpoints return the raw list.
 */
export function publicSpecs<T extends { name: string }>(specs: T[]): T[] {
  return specs
    .filter((spec) => !isSupplierPaperworkSpec(spec.name))
    .map((spec, index) => ({ spec, index, rank: displayRank(spec.name) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ spec }) => spec);
}
