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
  const found = new Set<string>();
  for (const group of numberGroups(text)) {
    found.add(group.joined);
    for (const part of group.parts) found.add(part);
  }
  return found;
}

/** «1 200» could be a thousand-two-hundred or two numbers; the pilot showed
 * product data is full of the second kind («GP0801-350 350х25», «TT 2211
 * 224.5»), and joining them always made numbers nobody wrote (350350). */
const NUMBER_GROUP =
  /\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?(?!\d)|\d+(?:[.,]\d+)?/g;

/** Each number of a text with both readings of a spaced group. */
function numberGroups(text: string) {
  return [...text.matchAll(NUMBER_GROUP)].map((match) => {
    const parts = match[0].split(/[ \u00a0\u202f]/).map(normaliseNumber);
    return {
      joined: normaliseNumber(match[0].replace(/[ \u00a0\u202f]/g, '')),
      parts,
    };
  });
}

/** The first number of a text that the source does not have, if any. */
function unknownNumber(text: string, known: Set<string>) {
  for (const group of numberGroups(text)) {
    if (known.has(group.joined)) continue;
    const missing = group.parts.find((part) => !known.has(part));
    if (missing !== undefined) return missing;
  }
  return null;
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

/** Cyrillic letters that look Latin (and «×»), folded to the Latin one. */
const FOLD: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  х: 'x',
  у: 'y',
  '×': 'x',
};

/**
 * A comparison key for codes and Latin words: squashed, and with look-alike
 * letters folded. Suppliers type «М10х12х40» with Cyrillic М and х, a model
 * writes «M10x12x40» with Latin ones — the same code, and it must not read
 * as a word the data does not have.
 */
function codeKey(text: string) {
  return squash(
    text.toLowerCase().replace(/[авекмнорстху×]/g, (ch) => FOLD[ch]),
  );
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

/** Supplier abbreviations a name may spell out instead of keeping. */
const SPELLED_OUT: Record<string, RegExp> = {
  bl: /бесщ[её]т/i,
  bim: /биметалл/i,
  hss: /быстрорежущ/i,
};

/**
 * Claims a model likes to add and a supplier's data almost never backs:
 * stock, warranty, delivery terms, discounts, «the best». Each is allowed only
 * when the source itself says it (a spec «Гарантия: 3 года» is a fact).
 */
const CLAIMS: Array<[RegExp, string]> = [
  // «на складе» alone is fine — «стеллаж для склада», «работа на складе».
  [/в\s+наличии|(есть|всегда|имеется|имеются)\s+на\s+складе/i, 'наличие'],
  [/гаранти/i, 'гарантия'],
  [/бесплатн/i, '«бесплатно»'],
  // The lookbehind keeps «реакции» from reading as «акции».
  [/скидк|(?<![а-яё])акци[яи]|распродаж/i, 'скидки и акции'],
  [/официальн\w*\s+(дилер|представител|дистрибьютор)/i, '«официальный дилер»'],
  [/сертифиц|сертификат/i, 'сертификация'],
  [
    // Comparisons with other products only. «Идеально подходит» is a stock
    // phrase, not a claim: the prompt discourages it, rejecting a whole
    // description for it would only throw away a paid answer.
    // «самый/самая/самое/самые/самых/самым/самую» only — «по самому
    // инструменту», «самого прибора» are the pronoun «сам», not a superlative.
    /(?<![а-яё])(лучш|сам(ый|ая|ое|ые|ых|ым|ую)(?![а-яё])|непревзойд|№\s*1(?!\d)|номер\s+один)/i,
    'превосходная степень',
  ],
  [
    /(?<![а-яё])(германи|япони|кита[йяе]|росси[ия]|тайван|итали|польш|чехи|сша(?![а-яё]))/i,
    'страна производства',
  ],
];

/** Things no field may contain, whatever the source says. */
const FORBIDDEN: Array<[RegExp, string]> = [
  // A Belarusian number, or any «(29) 668-00-11» shape. Bounded so a length
  // («375 мм», «37500 об/мин») is not a phone.
  [
    /(?<!\d)\+?375[\s(-]*\d{2}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)|\(\d{2,3}\)\s*\d{3}[-\s]?\d{2}[-\s]?\d{2}(?!\d)/,
    'телефон',
  ],
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
  // The name keeps every code and number of the supplier's, and BULL's run
  // past 150 characters — the field's own cap (ai-fields.ts) is the limit.
  name: { min: 8, max: 200 },
  descriptionShort: { min: 30, max: 320 },
  // A thin card's one honest paragraph can be short.
  descriptionFull: { min: 80, max: 3500 },
  description: { min: 150, max: 3000 },
  // The prompt asks for ≤ 70 / ≤ 160; a little over is cut by the search
  // engine, not wrong — refusing it would waste a paid answer.
  seoTitle: { min: 15, max: 80 },
  seoDescription: { min: 60, max: 230 },
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
  const sourceKey = codeKey(source);

  for (const [field, value] of Object.entries(values)) {
    const reason = checkField(
      field,
      value,
      input,
      source,
      sourceNumbers,
      sourceKey,
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
  sourceKey: string,
): string | null {
  const limit = LIMITS[field];
  if (limit && value.length < limit.min)
    return `слишком коротко (${value.length} < ${limit.min})`;
  if (limit && value.length > limit.max)
    return `слишком длинно (${value.length} > ${limit.max})`;

  for (const [pattern, what] of FORBIDDEN) {
    if (pattern.test(value)) return `недопустимо: ${what}`;
  }

  // «ДxШxВ», «ВxГ» — a dimension label with a Latin x between Cyrillic
  // letters, not a look-alike word; the pilot refused five good descriptions.
  const mixed = (
    value
      .replace(/(?<=[А-ЯЁ])[xX×](?=[А-ЯЁ])/g, ' ')
      .match(/[A-Za-zА-Яа-яЁё]+/g) ?? []
  ).find(isMixedScript);
  if (mixed) return `слово из смешанных латиницы и кириллицы: «${mixed}»`;

  const letters = value.match(/[A-Za-zА-Яа-яЁё]/g) ?? [];
  const cyrillic = value.match(/[А-Яа-яЁё]/g) ?? [];
  // Prose only: a name or an SEO title is mostly brand, series and model
  // («Бур SDS-plus EXPERT STARTUL 10х100х160 мм») and read as «not Russian».
  if (
    field !== 'name' &&
    field !== 'seoTitle' &&
    letters.length >= 20 &&
    cyrillic.length / letters.length < 0.5
  ) {
    return 'текст не на русском';
  }

  const unknown = unknownNumber(value, sourceNumbers);
  if (unknown !== null) return `число ${unknown} не из данных товара`;

  for (const word of latinWords(value)) {
    if (!sourceKey.includes(codeKey(word))) {
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
  // «… (2 шт.)», «… 3 мм.» end in an abbreviation's dot — that one is fine.
  if (
    /[!?…]$/.test(value) ||
    (/\.$/.test(value) && !/(^|[\s(])[а-яёa-z]{1,4}\.\)?$/i.test(value))
  )
    return 'название заканчивается знаком препинания';
  if (/купить|цена|минск|доставк/i.test(value))
    return 'в названии продающие слова';
  // Cyrillic only: brand, series and model are Latin capitals by nature
  // («Бокорезы EXPERT STARTUL SE4260-16») and read as shouting.
  const letters = value.match(/[А-Яа-яЁё]/g) ?? [];
  const upper = value.match(/[А-ЯЁ]/g) ?? [];
  if (letters.length > 10 && upper.length / letters.length > 0.6) {
    return 'название капсом';
  }

  const old = fixHomoglyphs(input.oldName);
  const next = codeKey(fixHomoglyphs(value));

  // The brand stays, if the old name carried it.
  const brand = input.brand?.trim();
  if (
    brand &&
    codeKey(old).includes(codeKey(brand)) &&
    !next.includes(codeKey(brand))
  ) {
    return `пропал бренд «${brand}»`;
  }

  // Article numbers, model codes and the supplier's Latin series words
  // (EXPERT, XLTpro, NYLON) stay — the prompt asks for exactly this. Two
  // honest rewrites count as kept: a value with its unit in Russian
  // («1000V» → «1000 В») and a known abbreviation spelled out («BL» →
  // «бесщёточный»).
  for (const token of codeTokens(old)) {
    if (next.includes(codeKey(token))) continue;
    const unit = /^(\d+(?:[.,]\d+)?)(v|w|ah|mah|mm|cm|kg|nm|rpm)$/i.exec(token);
    if (unit && numbersIn(value).has(normaliseNumber(unit[1]))) continue;
    const spelled = SPELLED_OUT[token.toLowerCase()];
    if (spelled && spelled.test(value)) continue;
    return `пропал код или модель «${token}»`;
  }

  // Sizes and pack quantities stay: «М10х12х40», «(4 шт в зип-локе)».
  // A size may come back more exact from the specs: «125х22» → «125х22,2».
  const kept = [...numbersIn(fixHomoglyphs(value))];
  for (const group of numberGroups(old)) {
    const found = [group.joined, ...group.parts].some((number) =>
      kept.some((next) => next === number || next.startsWith(`${number}.`)),
    );
    if (!found) return `пропало число ${group.parts[0]} из старого названия`;
  }
  return null;
}

/**
 * How alike two texts are, 0…1: Jaccard over three-word shingles with the
 * numbers masked out. Masked, because the variants of one line (a 10 mm and
 * a 12 mm bit, 4 or 50 anchors a pack) differ *only* in numbers — and a page
 * that differs from its sibling only in numbers is the near-duplicate a
 * search engine folds into one result.
 */
export function textSimilarity(a: string, b: string) {
  const shingles = (text: string) => {
    const words = text
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\d+(?:[.,]\d+)?/g, '#')
      .split(/[^a-zа-я#]+/i)
      .filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i + 2 < words.length; i++) {
      set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
    return set;
  };
  const left = shingles(a);
  const right = shingles(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const shingle of left) if (right.has(shingle)) shared++;
  return shared / (left.size + right.size - shared);
}

/** Over this, a description is flagged as a near-copy of a sibling's. */
export const NEAR_DUPLICATE_SIMILARITY = 0.7;

/**
 * Every code check an AI answer goes through before a field is written, in
 * words — the admin's «Шаблоны и проверки» tab lists them, so a refused field
 * is never a mystery. Keep in step with checkField / checkName above.
 */
export const AI_CHECKS: Array<{ id: string; title: string; detail: string }> = [
  {
    id: 'length',
    title: 'Длина поля',
    detail:
      'Не короче и не длиннее пределов поля (название, краткое и полное описание, SEO-заголовок до 70, SEO-описание до 230 символов).',
  },
  {
    id: 'forbidden',
    title: 'Запрещённое',
    detail: 'Телефоны, ссылки, e-mail, цены, HTML и Markdown-разметка.',
  },
  {
    id: 'mixed',
    title: 'Смешанные алфавиты',
    detail:
      'Слово из латиницы и кириллицы вперемешку («Mакita») — признак ошибки модели.',
  },
  {
    id: 'russian',
    title: 'Русский язык',
    detail:
      'Связный текст должен быть по-русски (коды и латинские названия серий — можно).',
  },
  {
    id: 'numbers',
    title: 'Числа из данных',
    detail:
      'Каждое число должно быть в данных товара; «М10» = «M10», «3/4» = «¾», единицы и пробелы не важны.',
  },
  {
    id: 'latin',
    title: 'Латинские слова из данных',
    detail:
      'Латинское слово или код, которого нет в данных товара, — выдумка; сравнение с «двойниками» М/M, х/x.',
  },
  {
    id: 'claims',
    title: 'Неподтверждённые утверждения',
    detail:
      'Наличие, гарантия, страна производства, «лучший», «самый» — только если это есть в данных.',
  },
  {
    id: 'thin',
    title: 'Мало данных',
    detail:
      'Без описания и с менее чем тремя характеристиками длинное описание будет водой — не пишется.',
  },
  {
    id: 'payment',
    title: 'Оплата по безналу',
    detail:
      'SEO-описание товара обязано упоминать оплату по безналу для организаций.',
  },
  {
    id: 'name-punctuation',
    title: 'Название: конец',
    detail: 'Без точки и другого знака препинания в конце.',
  },
  {
    id: 'name-selling',
    title: 'Название: продающие слова',
    detail: 'Без «купить», «цена», «Минск» и т. п.',
  },
  {
    id: 'name-caps',
    title: 'Название: капс',
    detail: 'Не целиком заглавными буквами.',
  },
  {
    id: 'name-brand',
    title: 'Название: бренд',
    detail: 'Бренд из старого названия должен остаться.',
  },
  {
    id: 'name-model',
    title: 'Название: код и модель',
    detail:
      'Каждый код и обозначение модели из старого названия должны остаться.',
  },
  {
    id: 'name-numbers',
    title: 'Название: числа',
    detail:
      'Каждое число старого названия (размеры, фасовка) должно остаться — по ним работают переключатель размеров и подбор крепежа.',
  },
  {
    id: 'similar',
    title: 'Похожие описания',
    detail:
      'Описание почти как у уже записанного в этой задаче (варианты линейки) — помечается предупреждением.',
  },
  {
    id: 'verify',
    title: 'Вторая проверка (модель)',
    detail:
      'Второй запрос к модели сверяет смысл названия и краткого описания с данными; молчащий проверяющий = пачка повторяется. Отключается AI_VERIFY=false.',
  },
];
