/**
 * Whether a parsed characteristic should become a catalogue filter.
 *
 * Parsers used to mark every spec `filterable: true`, so a supplier's spec table
 * turned straight into facets — including "Штрихкод" (a different value for
 * every single product) and "Производитель" (a 200-character legal address).
 * A filter with as many options as there are products is not a filter.
 *
 * This is only the default at creation time; an admin can flip any spec in
 * /admin/specifications, and `POST /admin/specifications/auto-select` still
 * applies the smarter distinct-value heuristic over real data afterwards.
 */

/**
 * Identity and paperwork fields. Matched as substrings against the lowercased
 * name, so "Штрихкод EAN" and "Импортер/Продавец" are both covered.
 */
const NEVER_FILTERABLE = [
  'штрих',
  'ean',
  'gtin',
  'артикул',
  'код товара',
  'sku',
  'производитель',
  'бренд',
  'brand',
  'импортер',
  'импортёр',
  'поставщик',
  'продавец',
  'срок годности',
  'серийн',
  'дата изготовл',
  'гарантийный талон',
];

/**
 * A value this long is prose, not a facet. Catches the free-text rows suppliers
 * put in their spec tables without having to enumerate them.
 */
const MAX_FILTERABLE_VALUE_LENGTH = 60;

export function shouldBeFilterable(name: string, value?: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;

  if (NEVER_FILTERABLE.some((needle) => normalized.includes(needle))) {
    return false;
  }

  if (value && value.trim().length > MAX_FILTERABLE_VALUE_LENGTH) return false;

  return true;
}
