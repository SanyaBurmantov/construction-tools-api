/**
 * Canonical, source-independent identity for a product characteristic.
 *
 * `Specification` is scoped to a category (`@@unique([categoryId, key])`), so
 * "Вес" is 773 separate rows in production — one per category. That is fine as
 * storage, but it made the catalogue unusable:
 *
 *  - the facet builder returned one entry per row, so opening a parent category
 *    put "Вес" in the sidebar ten times, each with a slice of the values;
 *  - the `specs` query parameter carried a per-category UUID, so ticking a value
 *    filtered one subcategory and dropped the rest of the subtree;
 *  - suppliers spell the same thing differently — `Мощность ( Вт )`,
 *    `Мощность (Вт)`, `Мощность, Вт` and `Мощность, Вт.` all coexist, and
 *    `generateSlug` only collapses them when the punctuation happens to
 *    transliterate the same way (`об/мин` and `обмин` do not).
 *
 * `canonicalSpec()` returns the key the facets group by, a display name and the
 * unit lifted out of the name. **The unit is part of the key**: four spellings
 * of `Мощность, Вт` are one filter, but `Длина, мм` and `Длина, м` stay two —
 * merging them would put 1.5 and 1500 on the same axis.
 *
 * Pure, no DB access — unit-tested directly, and used both by the parsers at
 * write time and by the normalizer cron over everything already imported.
 */

/**
 * Units suppliers append to a characteristic name. Only these are stripped off
 * into `unit` — a parenthesised word that is *not* here is part of the name
 * ("Макс. диаметр сверления (дерево)" must not lose "дерево").
 *
 * Keys are the folded spelling (see `unitToken`), values are how we render it.
 */
const UNIT_CANON: Record<string, string> = {
  // length
  mm: 'мм',
  sm: 'см',
  dm: 'дм',
  m: 'м',
  km: 'км',
  dyujm: 'дюйм',
  // mass
  kg: 'кг',
  g: 'г',
  mg: 'мг',
  t: 'т',
  // power / electricity
  vt: 'Вт',
  kvt: 'кВт',
  v: 'В',
  kv: 'кВ',
  vgc: 'В/Гц',
  a: 'А',
  ma: 'мА',
  ach: 'А·ч',
  mach: 'мА·ч',
  va: 'ВА',
  kva: 'кВА',
  gc: 'Гц',
  kgc: 'кГц',
  om: 'Ом',
  ls: 'л.с.',
  // torque / force
  nm: 'Н·м',
  knm: 'кН·м',
  n: 'Н',
  kn: 'кН',
  kgfsm: 'кгс·см',
  kgfm: 'кгс·м',
  // rotation / speed
  obmin: 'об/мин',
  udmin: 'уд/мин',
  hodmin: 'ход/мин',
  mmin: 'м/мин',
  ms: 'м/с',
  // volume / flow / area
  l: 'л',
  ml: 'мл',
  lmin: 'л/мин',
  lch: 'л/ч',
  m3ch: 'м³/ч',
  m3min: 'м³/мин',
  m3: 'м³',
  m2: 'м²',
  mm2: 'мм²',
  // pressure
  bar: 'бар',
  atm: 'атм',
  mpa: 'МПа',
  kpa: 'кПа',
  pa: 'Па',
  // misc
  db: 'дБ',
  dba: 'дБ(А)',
  c: '°C',
  procent: '%',
  sht: 'шт',
  ip: 'IP',
  let: 'лет',
  god: 'год',
  mes: 'мес',
};

/** Reverse map: rendered unit → folded token, for the key suffix. */
const UNIT_SLUG = new Map(
  Object.entries(UNIT_CANON).map(([token, rendered]) => [rendered, token]),
);

/**
 * Folds a candidate unit to a `UNIT_CANON` key: lowercase, cyrillic to latin,
 * separators dropped. `А/ч`, `Ач`, `А.ч.` and `А*Ч` all land on `ach`;
 * `об/мин` and `обмин` both on `obmin`.
 */
function unitToken(raw: string): string {
  // `°С` with a cyrillic С folds to `s`, which is not a unit — but a degree
  // sign only ever means degrees, so it decides on its own.
  if (raw.includes('°')) return 'c';
  return foldToLatin(raw).replace(/[^a-z0-9]/g, '');
}

/**
 * Word-level synonyms, applied before the key is assembled, so the key is
 * stable across the spellings suppliers actually use.
 */
const WORD_SYNONYMS: Record<string, string> = {
  // abbreviations
  maksimalnyj: 'maks',
  maksimalnaya: 'maks',
  maksimalnoe: 'maks',
  maksimalno: 'maks',
  minimalnyj: 'min',
  minimalnaya: 'min',
  minimalnoe: 'min',
  minimalno: 'min',
  kolichestvo: 'kolvo',
  diam: 'diametr',
  // mass
  massa: 'ves',
  // the same idea spelled two ways
  primenenie: 'naznachenie',
  // country of origin
  izgotovleniya: 'proizvodstva',
  proizvoditelya: 'proizvodstva',
  // dimensions
  gabaritnye: 'gabarity',
  razmery: 'gabarity',
  // rotation
  oborotov: 'oboroty',
};

/**
 * Words that carry no meaning in a characteristic name. Dropped so
 * "Габариты ДxШxВ, см" and "Габариты (ДхШхВ)" reach the same key.
 */
const STOP_WORDS = new Set([
  'i',
  'v',
  's',
  'na',
  'dlya',
  'po',
  'iz',
  'pri',
  'ili',
  // "Масса нетто" is the mass; "нетто" adds nothing a filter can use
  'netto',
  'izdeliya',
  'tovara',
]);

/**
 * Base keys fixed by hand, because the generic rules either cannot reach them
 * or would merge too much. Every entry is a duplicate pair observed in the
 * production catalogue. Looked up *before* the unit suffix is appended.
 */
const KEY_ALIASES: Record<string, { key: string; name: string }> = {
  ves: { key: 'ves', name: 'Вес' },
  // Packaging weight is a different number and must stay a different filter.
  vesupakovkoj: { key: 'ves-brutto', name: 'Вес с упаковкой' },
  vesupakovke: { key: 'ves-brutto', name: 'Вес с упаковкой' },
  vesbrutto: { key: 'ves-brutto', name: 'Вес с упаковкой' },
  brutto: { key: 'ves-brutto', name: 'Вес с упаковкой' },
  stranaproizvodstva: { key: 'strana', name: 'Страна производства' },
  strana: { key: 'strana', name: 'Страна производства' },
  gabarity: { key: 'gabarity', name: 'Габариты (ДхШхВ)' },
  gabarityupakovke: { key: 'gabarity-upakovki', name: 'Габариты упаковки' },
  gabarityupakovki: { key: 'gabarity-upakovki', name: 'Габариты упаковки' },
  naznachenie: { key: 'naznachenie', name: 'Назначение' },
  garantiya: { key: 'garantiya', name: 'Гарантия' },
  garantijnyjsrok: { key: 'garantiya', name: 'Гарантия' },
  srokgarantii: { key: 'garantiya', name: 'Гарантия' },
  chislooboroty: { key: 'oboroty', name: 'Обороты' },
  oborotyholostogohoda: { key: 'oboroty', name: 'Обороты' },
  chastotaoboroty: { key: 'oboroty', name: 'Обороты' },
  emkostakkumulyatora: {
    key: 'emkost-akkumulyatora',
    name: 'Ёмкость аккумулятора',
  },
  urovenzvukovogodavleniyalpa: {
    key: 'uroven-zvukovogo-davleniya',
    name: 'Уровень звукового давления',
  },
  urovenzvukovogodavleniya: {
    key: 'uroven-zvukovogo-davleniya',
    name: 'Уровень звукового давления',
  },
  urovenzvukovojmoshchnostilwa: {
    key: 'uroven-zvukovoj-moshchnosti',
    name: 'Уровень звуковой мощности',
  },
  urovenzvukovojmoshchnosti: {
    key: 'uroven-zvukovoj-moshchnosti',
    name: 'Уровень звуковой мощности',
  },
  stepenzashchityip: { key: 'stepen-zashchity', name: 'Степень защиты' },
  stepenzashchity: { key: 'stepen-zashchity', name: 'Степень защиты' },
};

export type CanonicalSpec = {
  /** Stable, source-independent identity. What the facets group by. */
  key: string;
  /** Display name, without the unit and without supplier punctuation. */
  name: string;
  /** Unit lifted out of the name; also part of `key`. */
  unit?: string;
};

/**
 * Canonical identity of a characteristic name, or `null` when the name is not
 * usable (empty, or punctuation only).
 *
 * `fallbackUnit` is used when the name itself carries no unit — the normalizer
 * infers one from the values (`Вес` whose values all read "0.5 кг"), which is
 * what lets `Вес` and `Вес, кг` become a single filter.
 */
export function canonicalSpec(
  rawName: string,
  fallbackUnit?: string,
): CanonicalSpec | null {
  const cleaned = cleanName(rawName);
  if (!cleaned) return null;

  const split = splitUnit(cleaned);
  const baseName =
    cleanName(split.base.replace(DIMENSION_DECORATION, ' ')) ||
    cleanName(split.base) ||
    cleaned;
  const unit = split.unit ?? normalizeUnit(fallbackUnit);

  const words = foldToLatin(baseName)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => WORD_SYNONYMS[word] ?? word)
    .filter((word) => !STOP_WORDS.has(word));

  if (!words.length) return null;

  const alias = KEY_ALIASES[words.join('')];
  const baseKey = alias?.key ?? words.join('-');
  const suffix = unit ? `~${UNIT_SLUG.get(unit) ?? unitToken(unit)}` : '';

  return {
    key: `${baseKey}${suffix}`,
    name: alias?.name ?? prettifyName(baseName),
    unit,
  };
}

/** Accepts a rendered or folded unit spelling and returns the rendered one. */
export function normalizeUnit(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  return UNIT_CANON[unitToken(raw)];
}

/**
 * Unit shared by a specification's values, for specifications whose *name*
 * carries none. Requires a clear majority so one stray "5 кг" in a column of
 * part numbers cannot label the whole specification.
 */
export function inferUnitFromValues(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  let considered = 0;

  for (const raw of values) {
    const value = cleanValue(raw);
    if (!value) continue;
    considered++;

    // "0.5 кг" / "12 В" — a number followed by something unit-shaped.
    const match = value.match(
      /^[+-]?[\d\s]+(?:[.,]\d+)?\s*([А-Яа-яЁёA-Za-z°%³²/.*·]{1,8})\.?$/,
    );
    const unit = match ? normalizeUnit(match[1]) : undefined;
    if (!unit) continue;

    counts.set(unit, (counts.get(unit) ?? 0) + 1);
  }

  if (considered < 3) return undefined;

  for (const [unit, count] of counts) {
    if (count / considered >= 0.8) return unit;
  }
  return undefined;
}

/**
 * The "ДхШхВ" decoration, in every spelling suppliers use: `ДхШхВ`, `ДxШxВ`,
 * `Д х Ш х В`, `(Д х Ш х В)`. It says nothing a filter can use — "Габариты" and
 * "Габариты (ДхШхВ)" are one characteristic.
 *
 * Removed by this pass rather than by listing `д`, `ш`, `в` as stop words,
 * which is what the first version did: a bare letter is also how suppliers
 * label a measurement (`Размер H`, `Размер S`), and dropping it merged those
 * into plain "Размер".
 */
const DIMENSION_DECORATION =
  /\(?\s*[ДдDd]\s*[хxX×*]\s*[ШшSs]\s*(?:[хxX×*]\s*[ВвHh])?\s*\)?/g;

/**
 * Strips the decoration suppliers put around a characteristic name: list
 * bullets, trailing colons and commas, repeated and non-breaking whitespace.
 */
function cleanName(raw: string): string {
  return (raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[•·▪◦*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:–—-]+/, '')
    .replace(/[\s,.;:–—]+$/, '')
    .trim();
}

/**
 * Lifts a trailing unit out of the name. Recognises `, мм`, ` (мм)`,
 * ` ( мм )`, `, мм.` and a bare trailing ` мм`, but only when the candidate is
 * a unit we know — otherwise `(дерево)` would be swallowed.
 */
function splitUnit(name: string): { base: string; unit?: string } {
  const patterns: Array<{ pattern: RegExp; minUnitLength: number }> = [
    // Мощность (Вт) · Мощность ( Вт )
    //
    // Two characters minimum. Suppliers label distinct measurements of one
    // product with a bare letter in brackets — `Длина (A), мм`, `Длина (L), мм`,
    // `Длина (H), мм` are three different lengths — and `A` and `L` happen to
    // be amperes and litres, so reading them as units silently merged them into
    // one filter. A genuine single-letter unit is always comma-separated
    // (`Напряжение, В`), which the next pattern handles.
    { pattern: /^(.*?)[\s,]*\(\s*([^()]{1,12}?)\s*\)\s*$/, minUnitLength: 2 },
    // Мощность, Вт · Мощность, Вт.
    { pattern: /^(.*?),\s*([^,()]{1,12}?)\.?\s*$/, minUnitLength: 1 },
    // Степень защиты IP — a bare trailing word. Single letters are excluded
    // here: "Класс А" and "Группа В" are not measured in amperes or volts.
    {
      pattern: /^(.*?)\s+([А-Яа-яЁёA-Za-z°%³²]{1,6}\d?)\s*$/,
      minUnitLength: 2,
    },
  ];

  for (const { pattern, minUnitLength } of patterns) {
    const match = name.match(pattern);
    if (!match) continue;

    const base = match[1].trim();
    const candidate = match[2].trim();
    if (!base || candidate.length < minUnitLength) continue;

    const unit = UNIT_CANON[unitToken(candidate)];
    if (!unit) continue;

    // "Мощность ( Вт )" has one unit, not two: recurse so a name that carries
    // both a parenthesised and a comma-separated unit is reduced once.
    const nested = splitUnit(base);
    return { base: nested.unit ? nested.base : base, unit };
  }

  return { base: name };
}

/**
 * Display form: a single leading capital, the rest left alone so `IP`, `LwA`
 * and `DIN` survive. An all-caps name is lowercased first, otherwise
 * `ПРИМЕНЕНИЕ` and `Применение` would stay two different labels.
 */
export function prettifyName(name: string): string {
  const cleaned = cleanName(name);
  if (!cleaned) return cleaned;

  const letters = cleaned.replace(/[^\p{L}]/gu, '');
  const isShouting =
    letters.length > 2 && letters === letters.toLocaleUpperCase('ru');
  const base = isShouting ? cleaned.toLocaleLowerCase('ru') : cleaned;

  return base.charAt(0).toLocaleUpperCase('ru') + base.slice(1);
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'j',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** Lowercases and folds cyrillic to latin so keys are ASCII and comparable. */
function foldToLatin(value: string): string {
  return value
    .toLocaleLowerCase('ru')
    .split('')
    .map((char) => CYRILLIC_TO_LATIN[char] ?? char)
    .join('');
}

/** A supplier's ways of saying "no data", as folded spellings. */
const EMPTY_VALUES = new Set([
  '',
  '-',
  '--',
  '---',
  '—',
  '–',
  'n/a',
  'na',
  'нд',
  'н/д',
  'нетданных',
  'неуказано',
  'неуказан',
  'неуказана',
  'отсутствует',
  'нетинформации',
  '?',
  '...',
  'null',
  'undefined',
  '!!пусто!!',
]);

/** Spellings of yes/no that suppliers mix freely, including case-only pairs. */
const BOOLEAN_VALUES: Record<string, string> = {
  да: 'Да',
  yes: 'Да',
  есть: 'Да',
  имеется: 'Да',
  вналичии: 'Да',
  '+': 'Да',
  нет: 'Нет',
  no: 'Нет',
};

/** Units where zero is physically meaningless, so a zero is bad data. */
const ZERO_IS_GARBAGE = new Set([
  'мм',
  'см',
  'дм',
  'м',
  'км',
  'дюйм',
  'кг',
  'г',
  'мг',
  'т',
  'Вт',
  'кВт',
  'В',
  'кВ',
  'А',
  'мА',
  'А·ч',
  'мА·ч',
  'ВА',
  'кВА',
  'Гц',
  'кГц',
  'Ом',
  'л.с.',
  'Н·м',
  'кН·м',
  'Н',
  'кН',
  'кгс·см',
  'кгс·м',
  'об/мин',
  'уд/мин',
  'ход/мин',
  'м/мин',
  'м/с',
  'л',
  'мл',
  'л/мин',
  'л/ч',
  'м³/ч',
  'м³/мин',
  'м³',
  'м²',
  'мм²',
  'бар',
  'атм',
  'МПа',
  'кПа',
  'Па',
  'дБ',
  'дБ(А)',
  'шт',
  'лет',
  'год',
  'мес',
]);

export type NormalizedValue = {
  /** Cleaned value, suitable for the product page. */
  display: string;
  /**
   * Value the facets group and filter by, or `null` when the value cannot be a
   * filter option (no data, or a physically impossible zero).
   */
  facet: string | null;
};

/**
 * Normalizes a characteristic value.
 *
 * Does three things the catalogue depends on:
 *  - folds case-only duplicates (`Нет` / `нет` were two checkboxes for the same
 *    thing in 98 specifications);
 *  - drops the unit when it merely repeats the specification's own unit, so
 *    `0.5 кг` and `0.5` are one option;
 *  - recognises "no data" and impossible zeros — `Вес = "0 кг"` was the single
 *    most common value of the weight filter, on 6188 products.
 */
export function normalizeSpecValue(
  rawValue: string,
  unit?: string,
): NormalizedValue {
  const display = cleanValue(rawValue);
  const probe = display.toLocaleLowerCase('ru').replace(/\s+/g, '');

  if (EMPTY_VALUES.has(probe)) return { display, facet: null };

  const boolean = BOOLEAN_VALUES[probe];
  if (boolean) return { display: boolean, facet: boolean };

  const numeric = asNumber(display, unit);
  if (numeric !== null) {
    if (numeric === 0 && unit && ZERO_IS_GARBAGE.has(unit)) {
      return { display, facet: null };
    }
    const rendered = formatNumber(numeric);
    return { display: rendered, facet: rendered };
  }

  // Free text: fold the first letter only. Lowercasing everything would
  // destroy model names and abbreviations ("HSS", "CrV", "ABS").
  const folded = display.charAt(0).toLocaleUpperCase('ru') + display.slice(1);
  return { display: folded, facet: folded };
}

function cleanValue(raw: string): string {
  return (raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s;:]+/, '')
    .replace(/[\s;:]+$/, '')
    .trim();
}

/**
 * A value that is a single number, optionally followed by its own unit.
 * Returns null for anything else — ranges, lists and "2 шт в комплекте" stay
 * text, because turning those into numbers would merge different options.
 */
function asNumber(value: string, unit?: string): number | null {
  const withoutUnit = unit
    ? value.replace(new RegExp(`\\s*${escapeRegExp(unit)}\\.?\\s*$`, 'iu'), '')
    : value;

  const trimmed = withoutUnit.trim().replace(/,/g, '.').replace(/\s/g, '');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return null;

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `1.50` → `1.5`, `2.0` → `2`, so the same number is one facet option. */
function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
