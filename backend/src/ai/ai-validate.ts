import type { AiEntity } from '@prisma/client';

/**
 * Checks on what a model wrote, before it is written. Pure — no DB, no HTTP —
 * and unit-tested against the answers seen on real cards.
 *
 * The rule behind every check: the storefront must not promise what the
 * supplier's data does not say. A clumsy sentence costs nothing; an invented
 * «12 кг», a wrong article number in the name or «в наличии» on a card that
 * runs out tomorrow misleads a buyer. A field that fails is not written (the
 * old text stays) and the reason is kept on the task item for an admin.
 */

/** Field key → why it was not written. */
export type Rejections = Record<string, string>;

/** Latin look-alikes suppliers type into Cyrillic words («Kлeщи»). */
const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
  Y: 'У',
  a: 'а',
  c: 'с',
  e: 'е',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
};

const CYRILLIC = /[а-яё]/i;
const LATIN = /[a-z]/i;

/** A word mixing scripts — «Kлeщи», «ШPУCa». */
function isMixedScript(word: string) {
  return CYRILLIC.test(word) && LATIN.test(word);
}

/**
 * Turns supplier homoglyph words back into Cyrillic, so «ШPУCa» in the source
 * does not count as the Latin token «PC» and does not let the model keep it.
 */
export function fixHomoglyphs(text: string) {
  return text.replace(/[A-Za-zА-Яа-яЁё]+/g, (word) =>
    isMixedScript(word)
      ? word.replace(/[A-Za-z]/g, (ch) => LATIN_TO_CYRILLIC[ch] ?? ch)
      : word,
  );
}

/**
 * Every number in a text, normalised: «1 200» → 1200, «12,5» → 12.5,
 * «12.50» → 12.5. Thousands separated by a space are joined first, so a price
 * or a weight is one number, not two.
 */
export function numbersIn(text: string): Set<string> {
  const joined = text.replace(/(\d)[ \u00a0\u202f](?=\d{3}(?!\d))/g, '$1');
  const found = new Set<string>();
  for (const match of joined.matchAll(/\d+(?:[.,]\d+)?/g)) {
    found.add(normaliseNumber(match[0]));
  }
  return found;
}

function normaliseNumber(raw: string) {
  const value = raw.replace(',', '.');
  if (!value.includes('.')) return value.replace(/^0+(?=\d)/, '');
  const [int, frac] = value.split('.');
  const trimmed = frac.replace(/0+$/, '');
  const head = int.replace(/^0+(?=\d)/, '');
  return trimmed ? `${head}.${trimmed}` : head;
}

/** Lower-case letters and digits only — «SDS-Max» and «SDS MAX» compare equal. */
function squash(text: string) {
  return text.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
}

/** Latin words of two or more characters: brand, model, technology names. */
function latinWords(text: string) {
  return (
    fixHomoglyphs(text).match(/[A-Za-z][A-Za-z0-9]*(?:[-+][A-Za-z0-9]+)*/g) ??
    []
  ).filter((word) => word.length >= 2);
}

/**
 * Code-like tokens of a product name — article numbers and model codes,
 * anything with a digit next to a letter («GBH», «18V-45», «HAAF3530»,
 * «P-9U0102»). They identify the product, so a rewritten name keeps them all.
 */
function codeTokens(name: string) {
  return (
    fixHomoglyphs(name).match(/[A-Za-z0-9][A-Za-z0-9\-./]*/g) ?? []
  ).filter(
    (token) =>
      /[A-Za-z]/.test(token) && (token.length >= 2 || /\d/.test(token)),
  );
}

/**
 * Claims a model likes to add and a supplier's data almost never backs:
 * stock, warranty, delivery terms, discounts, «the best». Each is allowed only
 * when the source itself says it (a spec «Гарантия: 3 года» is a fact).
 */
const CLAIMS: Array<[RegExp, string]> = [
  [/в\s+наличии|на\s+складе/i, 'наличие'],
  [/гаранти/i, 'гарантия'],
  [/бесплатн/i, '«бесплатно»'],
  [/скидк|акци[яи]|распродаж/i, 'скидки и акции'],
  [/официальн\w*\s+(дилер|представител|дистрибьютор)/i, '«официальный дилер»'],
  [/сертифиц|сертификат/i, 'сертификация'],
  [
    /(?<![а-яё])(лучш|самы[йхем]|сама[яю]|само[ейм]|идеальн|непревзойд|уникальн|№\s*1(?!\d)|номер\s+один)/i,
    'превосходная степень',
  ],
  [
    /(?<![а-яё])(германи|япони|кита[йяе]|росси[ия]|тайван|итали|польш|чехи|сша(?![а-яё]))/i,
    'страна производства',
  ],
];

/** Things no field may contain, whatever the source says. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\+?\s?375[\s(-]*\d{2}|\(\d{2,3}\)\s*\d{3}[-\s]?\d{2}/, 'телефон'],
  [
    /https?:\/\/|www\.|\b[a-z0-9-]+\.(by|ru|com|net|org)\b/i,
    'ссылка или домен',
  ],
  [/\d\s*(руб|byn|бел\.?\s*р|usd|eur|\$|€)|(руб|byn)\.?\s*\d/i, 'цена'],
  [/[<>`]|\*\*|^\s*#|\]\(/m, 'разметка (HTML или Markdown)'],
];

/** The SEO description must mention this (the shop sells to companies). */
const B2B_PAYMENT = /безнал/i;

export type ValidationInput = {
  entity: AiEntity;
  /**
   * Everything the model was shown, flattened to text: name, brand, sku,
   * model, category, specs, descriptions. A number or a Latin word in the
   * answer must be found here.
   */
  source: string;
  /** The entity's name before the rewrite. */
  oldName: string;
  brand?: string | null;
  /** Little to go on: no description and fewer than three specs. */
  thin?: boolean;
};

/** Hard limits per field — over them the field is not written. */
const LIMITS: Record<string, { min: number; max: number }> = {
  name: { min: 8, max: 150 },
  descriptionShort: { min: 30, max: 320 },
  descriptionFull: { min: 150, max: 3500 },
  description: { min: 150, max: 3000 },
  seoTitle: { min: 15, max: 75 },
  seoDescription: { min: 60, max: 175 },
};

/** A thin card gets one honest paragraph, not a page of filler. */
const THIN_DESCRIPTION_MAX = 700;

/**
 * Checks one entity's rewritten fields. Returns the fields to drop and why;
 * an empty object means everything may be written.
 */
export function validateAnswer(
  input: ValidationInput,
  values: Record<string, string>,
): Rejections {
  const rejected: Rejections = {};
  const source = fixHomoglyphs(input.source);
  const sourceNumbers = numbersIn(source);
  const sourceSquashed = squash(source);

  for (const [field, value] of Object.entries(values)) {
    const reason = checkField(
      field,
      value,
      input,
      source,
      sourceNumbers,
      sourceSquashed,
    );
    if (reason) rejected[field] = reason;
  }
  return rejected;
}

function checkField(
  field: string,
  value: string,
  input: ValidationInput,
  source: string,
  sourceNumbers: Set<string>,
  sourceSquashed: string,
): string | null {
  const limit = LIMITS[field];
  if (limit && value.length < limit.min)
    return `слишком коротко (${value.length} < ${limit.min})`;
  if (limit && value.length > limit.max)
    return `слишком длинно (${value.length} > ${limit.max})`;

  for (const [pattern, what] of FORBIDDEN) {
    if (pattern.test(value)) return `недопустимо: ${what}`;
  }

  const mixed = (value.match(/[A-Za-zА-Яа-яЁё]+/g) ?? []).find(isMixedScript);
  if (mixed) return `слово из смешанных латиницы и кириллицы: «${mixed}»`;

  const letters = value.match(/[A-Za-zА-Яа-яЁё]/g) ?? [];
  const cyrillic = value.match(/[А-Яа-яЁё]/g) ?? [];
  if (letters.length >= 20 && cyrillic.length / letters.length < 0.5) {
    return 'текст не на русском';
  }

  for (const number of numbersIn(value)) {
    if (!sourceNumbers.has(number))
      return `число ${number} не из данных товара`;
  }

  for (const word of latinWords(value)) {
    if (!sourceSquashed.includes(squash(word))) {
      return `«${word}» нет в данных товара`;
    }
  }

  for (const [pattern, what] of CLAIMS) {
    if (pattern.test(value) && !pattern.test(source)) {
      return `утверждение не из данных: ${what}`;
    }
  }

  if (field === 'name') return checkName(value, input);

  if (input.thin && (field === 'descriptionFull' || field === 'description')) {
    if (value.length > THIN_DESCRIPTION_MAX) {
      return `мало данных о товаре — описание длиннее ${THIN_DESCRIPTION_MAX} символов будет водой`;
    }
  }

  if (field === 'seoDescription' && !B2B_PAYMENT.test(value)) {
    return 'нет упоминания оплаты по безналу';
  }
  return null;
}

function checkName(value: string, input: ValidationInput): string | null {
  if (/[.!?…]$/.test(value)) return 'название заканчивается знаком препинания';
  if (/купить|цена|минск|доставк/i.test(value))
    return 'в названии продающие слова';
  const letters = value.match(/[A-Za-zА-Яа-яЁё]/g) ?? [];
  const upper = value.match(/[A-ZА-ЯЁ]/g) ?? [];
  if (letters.length > 10 && upper.length / letters.length > 0.6) {
    return 'название капсом';
  }

  const old = fixHomoglyphs(input.oldName);
  const next = squash(fixHomoglyphs(value));

  // The brand stays, if the old name carried it.
  const brand = input.brand?.trim();
  if (
    brand &&
    squash(old).includes(squash(brand)) &&
    !next.includes(squash(brand))
  ) {
    return `пропал бренд «${brand}»`;
  }

  // Article numbers and model codes stay.
  for (const token of codeTokens(old)) {
    if (!next.includes(squash(token)))
      return `пропал код или модель «${token}»`;
  }

  // Sizes and pack quantities stay: «М10х12х40», «(4 шт в зип-локе)».
  const kept = numbersIn(fixHomoglyphs(value));
  for (const number of numbersIn(old)) {
    if (!kept.has(number)) return `пропало число ${number} из старого названия`;
  }
  return null;
}
