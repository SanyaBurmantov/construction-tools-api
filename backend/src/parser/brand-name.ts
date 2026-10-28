/**
 * Which supplier "brand" values are actually brands.
 *
 * Suppliers fill the brand column with whatever their own catalogue needs:
 * dukon files spare parts under «запчасти», «Запчасти М-7»,
 * «Запчасти-Forsage стенды,PL-4»; products without a trademark under
 * «без товарного знака»; whole product groups under «Измерители», «Наборы»,
 * «Перчатки». Imported as-is they became `Brand` rows with landing pages —
 * «запчасти, 712 товаров» in the brand list, next to Makita.
 *
 * (The audit quoted them as «ззапчасти», «ббез товарного знака»: the doubled
 * first letter is the brand list's alphabet heading run into the name by a
 * text extractor. The stored names are clean.)
 *
 * Pure and dependency-free: `ProductIdentityService.upsertBrand()` uses it at
 * import time and `BrandCleanupService` to remove the rows already imported.
 */

/** Whole-name matches (lowercased, `ё`→`е`, spacing collapsed). */
const NOT_A_BRAND = new Set([
  // "no brand" in its many spellings
  'без товарного знака',
  'без бренда',
  'без марки',
  'без названия',
  'без производителя',
  'no name',
  'noname',
  'no brand',
  'нет',
  'нет данных',
  'не указан',
  'не указано',
  'неизвестно',
  'неизвестный',
  'н/д',
  'н/а',
  'n/a',
  'другое',
  'другие',
  'прочее',
  'прочие',
  'прочий',
  'разное',
  'китай',
  // product groups a supplier put in its brand column
  'измерители',
  'наборы',
  'перчатки',
  'спецодежда',
  'съемники',
  'лопата',
  'лампа',
  'стенд',
  'комплект дорожный',
]);

/**
 * «запчасти», «Запчасти М-7», «запчасти-вело», «Запчасти-Forsage electro»:
 * the supplier's spare-parts bucket. Whatever follows the word is a product
 * group or a tool family, not the maker of the part.
 */
const SPARE_PARTS = /^запчаст[иь](?=$|[\s\-–—,.:/])/;

/**
 * A measurement, not a maker: «420 литров/мин», «1650/1400/1100 л/мин»,
 * «2,7-3,3 л/мин», «130 кг/час» — a compressor's air flow that a substring
 * match on «Производитель…ность» put in the brand column (dukon) — and bare
 * numbers («390», «1 910»). Numbered trademarks (K2, WD-40, 3TON, M7,
 * Рубин-7, UNIVERSAL 9000) have letters and survive.
 */
const MEASUREMENT =
  /^[\d\s.,/\-–—]+\s*(?:л|литр[а-яё]*|l|кг|kg|м3|м³|куб\.?\s*м|m3|г|g|т|t)\s*\/\s*(?:мин|min|час|ч|h|сек|с|s)\.?$/;
const BARE_NUMBER = /^[\d\s.,/\-–—]+$/;

/** Longer than this is a legal address or a sentence, not a trademark. */
const MAX_BRAND_LENGTH = 50;

function fold(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * The brand name to store, or `null` when the value is not a brand. Trims and
 * collapses whitespace; keeps the supplier's casing (identity is the slug,
 * which is case-insensitive already, so «MAKITA» and «Makita» are one row).
 */
export function normalizeBrandName(
  raw: string | null | undefined,
): string | null {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  // Nothing but punctuation: "-", "—", ",", "?".
  if (!/[\p{L}\p{N}]/u.test(name)) return null;
  if (name.length > MAX_BRAND_LENGTH) return null;

  const folded = fold(name);
  if (NOT_A_BRAND.has(folded)) return null;
  if (SPARE_PARTS.test(folded)) return null;
  if (MEASUREMENT.test(folded) || BARE_NUMBER.test(folded)) return null;

  return name;
}

export function isRealBrandName(raw: string | null | undefined): boolean {
  return normalizeBrandName(raw) !== null;
}
