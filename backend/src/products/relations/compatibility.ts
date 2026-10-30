import { createHash } from 'node:crypto';

/** Bump whenever extraction or matching changes: older rows are never read. */
export const COMPATIBILITY_RULE_VERSION = 2;
/** Links kept per accessory. */
export const MAX_LINKS = 16;
/** One reference never fans out further than this — beyond it, it is a family. */
export const MAX_TARGETS_PER_REFERENCE = 8;
const MAX_REFERENCES = 16;
const MAX_TEXT_LENGTH = 12_000;

/** What an accessory's statement is read from. */
export type AccessoryEvidence = {
  name: string;
  brandId?: string | null;
  sku?: string | null;
  model?: string | null;
  descriptionShort: string | null;
  descriptionFull: string | null;
  aiLockedFields?: string[];
  /**
   * The owning supplier offer's own name. An AI-rewritten name is not the
   * supplier's claim, so the claim is read from here instead.
   */
  sourceName?: string | null;
};

/** What identifies the tool an accessory is said to fit. */
export type TargetIdentity = {
  id: string;
  name: string;
  brandId: string | null;
  model: string | null;
  sku: string | null;
};

export type RelationIdentity = TargetIdentity &
  AccessoryEvidence & { aiLockedFields: string[] };

export type RelationBrand = { id: string; name: string };
export type ModelReference = {
  brandId: string;
  /** Preferred spelling first; shorter fallbacks («AS 3001 HEPA» → «AS3001»). */
  codes: string[];
  field: 'name' | 'descriptionShort' | 'descriptionFull';
};

const md5 = (values: Array<string | null | undefined>) =>
  createHash('md5')
    .update(values.map((value) => value ?? '').join('\u001f'))
    .digest('hex');

/**
 * Everything a link's existence depends on, per side. Must match the SQL in
 * relation-select.ts: field order and NULL handling are intentional. Price,
 * stock and an AI rewrite of a tool's *description* do not move a link.
 */
export function accessorySignature(
  product: Pick<
    RelationIdentity,
    'name' | 'descriptionShort' | 'descriptionFull' | 'aiLockedFields'
  >,
): string {
  return md5([
    product.name,
    product.descriptionShort,
    product.descriptionFull,
    product.aiLockedFields.join('\u001e'),
  ]);
}

export function targetSignature(
  product: Pick<TargetIdentity, 'name' | 'brandId' | 'model' | 'sku'>,
): string {
  return md5([product.name, product.brandId, product.model, product.sku]);
}

/* ---- Model codes --------------------------------------------------------- */

// Suppliers type «ТН 4217-1», «BL 1016В» in Cyrillic: the same model.
const LOOKALIKES: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  У: 'Y',
};
const fold = (value: string) =>
  value.replace(/[АВЕКМНОРСТХУ]/gu, (char) => LOOKALIKES[char]);

const UNIT_WORD =
  /^(?:вт|w|квт|kw|мм|mm|см|cm|м|л|l|ач|ah|мач|mah|кг|kg|г|шт|бар|bar|дб|db|гц|hz|нм|nm|дж|об)\.?$/iu;
// A lone «в» is the preposition («в кор.»); volts and amps are capitalised.
const UNIT_LETTER = /^[ВАV]$/u;
const isUnit = (token: string) =>
  UNIT_WORD.test(token) || UNIT_LETTER.test(token);
const UNIT_SUFFIX =
  /^\d+(?:вт|w|квт|kw|мм|mm|см|cm|ач|ah|мач|mah|кг|kg|шт|бар|bar|дб|db|гц|hz|нм|nm|дж|л|l)$/iu;

/** «18В», «600Вт» — a quantity, not a model; «BL 1016В» is a model. */
function isQuantity(token: string): boolean {
  if (UNIT_SUFFIX.test(token)) return true;
  const volts = /^(\d+)[вv]$/iu.exec(token);
  if (volts) return Number(volts[1]) <= 400;
  const amps = /^(\d+)[аa]$/iu.exec(token);
  return Boolean(amps && Number(amps[1]) <= 100);
}

/**
 * One model token, normalized, or null. Lowercase Cyrillic is prose («в»,
 * «сменный», «кор.»); uppercase Cyrillic counts only where it looks Latin.
 */
function modelToken(raw: string): string | null {
  const token = raw.normalize('NFKC').replace(/[‐‑]/gu, '-');
  if (/[а-яё]/u.test(token)) return null;
  const upper = fold(token.toUpperCase());
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(upper)) return null;
  // «VX100-VX200» is a range of two models, not one.
  const pieces = upper.split('-');
  if (
    pieces.length > 1 &&
    pieces.filter((piece) => /[A-Z]/.test(piece) && /\d/.test(piece)).length > 1
  )
    return null;
  return pieces.join('');
}

// Punctuation ends a model: «AS 3001 + аксессуары», «VC 2015 (2 шт)»; a
// decimal («0,019"») stays one token, and not a model.
const TOKEN = /\d+[.,]\d+|[^\s,;:()[\]+/«»"'*]+|[,;:()[\]+/«»"'*]/gu;
const tokenize = (text: string) => text.match(TOKEN) ?? [];

/** Reads the model tokens starting at `start`; returns them and where it stopped. */
function readRun(
  tokens: string[],
  start: number,
): { parts: string[]; end: number } {
  const parts: string[] = [];
  let index = start;
  for (; index < tokens.length && parts.length < 6; index += 1) {
    const raw = tokens[index];
    const word = raw.replace(/\.+$/u, '');
    if (!word) break;
    // «1400 Вт», «2 шт.» — the number belongs to the unit.
    if (/^\d+(?:[-‐‑]\d+)*$/u.test(word) && isUnit(tokens[index + 1] ?? ''))
      break;
    if (isQuantity(word)) break;
    // A lone uppercase Cyrillic letter is a unit («18.0 В»), not a suffix.
    if (/^[А-ЯЁ]$/u.test(word)) break;
    const part = modelToken(word);
    if (!part) break;
    parts.push(part);
    if (word !== raw) {
      index += 1; // «DWYE.» ends the model, the dot included
      break;
    }
  }
  return { parts, end: Math.max(index, start + 1) };
}

/**
 * «R12», «PZ1» are a refrigerant and a bit profile, not models; a bare number
 * counts when it looks like one (Makita 9555, 440).
 */
function isCode(code: string): boolean {
  if (code.length > 30 || !/\d/.test(code)) return false;
  return /[A-Z]/.test(code)
    ? code.length >= 4
    : code.length >= 3 && !code.startsWith('0');
}

/**
 * Full spelling first, then without leading series words («LXT BL 1850B» →
 * «BL1850B»). What remains must still start with letters: «TB 3018» is not
 * «3018», or every «… 3018» of the brand would match.
 */
function leadingVariants(parts: string[]): string[] {
  const codes: string[] = [];
  for (let from = 0; from < parts.length; from += 1) {
    if (from > 0 && (/\d/.test(parts[from - 1]) || !/^[A-Z]/.test(parts[from])))
      break;
    const code = parts.slice(from).join('');
    if (isCode(code)) codes.push(code);
  }
  return codes;
}

/**
 * A reference also tries itself without trailing words («AS 3001 HEPA») —
 * words, not suffixes: «TE 4217-1 S» stays a different model from «TE 4217-1».
 */
function referenceCodes(parts: string[]): string[] {
  const codes = new Set<string>();
  for (let to = parts.length; to > 0; to -= 1) {
    if (to < parts.length && !/^[A-Z]{4,}$/.test(parts[to])) break;
    for (const code of leadingVariants(parts.slice(0, to))) codes.add(code);
  }
  return [...codes];
}

/** Whole identifier of a lone value (sku/model column), or null. */
export function modelCode(value: string | null | undefined): string | null {
  if (!value || value.length > 80) return null;
  const tokens = tokenize(value);
  const { parts, end } = readRun(tokens, 0);
  if (end < tokens.length || !parts.length) return null;
  const code = parts.join('');
  return isCode(code) && /[A-Z]/.test(code) ? code : null;
}

/* ---- Brands -------------------------------------------------------------- */

export type BrandMatcher = {
  /** The brand spelled at the very start of `text`, and its length. */
  at(text: string): { brand: RelationBrand; length: number } | null;
  name(id: string | null): string | undefined;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One alternation for the whole brand table, longest name first. */
export function createBrandMatcher(brands: RelationBrand[]): BrandMatcher {
  const byName = new Map<string, RelationBrand | null>();
  for (const brand of brands) {
    const key = brand.name.trim().toLowerCase();
    // «РС», «K2» — too short to tell from a model or a word.
    if (key.length < 3 || !/\p{L}/u.test(key)) continue;
    byName.set(key, byName.has(key) ? null : brand);
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const pattern = names.length
    ? new RegExp(
        `^(?:${names.map(escapeRegex).join('|')})(?=[\\s,;:()]|$)`,
        'iu',
      )
    : null;
  const ids = new Map(brands.map((brand) => [brand.id, brand.name]));
  return {
    at(text) {
      const match = pattern?.exec(text);
      // «Практик», «Помощник» are brands and words: a brand is capitalised.
      if (!match || match[0][0] === match[0][0].toLowerCase()) return null;
      const brand = byName.get(match[0].toLowerCase());
      return brand ? { brand, length: match[0].length } : null;
    },
    name: (id) => (id ? ids.get(id) : undefined),
  };
}

/* ---- Accessories --------------------------------------------------------- */

// «для», «к», «под» start a claim only in a name; prose needs a real phrase.
const NAME_MARKER = /(?:^|[\s(])(?:для|к|под|на)\s+/iu;
const ACCESSORY =
  /(?:^|\s)(?:фильтр[а-яё]*|аккумулятор(?:ы|а|ов)?|зарядн[а-яё]*|адаптер[а-яё]*|переходник[а-яё]*|насадк[а-яё]*|бур(?:ы|а|ов)?|сверл[а-яё]*|диск(?:и|а|ов)?|цеп[ьи]|шин[аы]|патрон[а-яё]*|нож(?:и|а|ей)?|щ[её]тк[а-яё]*|меш(?:ок|ка|ки|ков)|пылесборник[а-яё]*|ремен[а-яё]*|ремень|оснастк[а-яё]*|шланг[а-яё]*|леск[а-яё]*|катушк[а-яё]*|головк[а-яё]*|звездочк[а-яё]*|пилк[а-яё]*|полотн[а-яё]*|кожух[а-яё]*|якор[ья]|статор[а-яё]*|ротор[а-яё]*|шестерн[а-яё]*|выключател[а-яё]*|щеткодержател[а-яё]*|редуктор[а-яё]*|подошв[а-яё]*|рукоятк[а-яё]*|кейс[а-яё]*|чехол|чехл[а-яё]*|сопл[оа]|упор[а-яё]*|направляющ[а-яё]*|бит[аы]|запчаст[а-яё]*|комплектующ[а-яё]*)(?=\s|$)/iu;
const TOOL =
  /(?:^|\s)(?:дрель|дрели|шурупов[её]рт[а-яё]*|перфоратор[а-яё]*|пылесос[а-яё]*|шлифмашин[а-яё]*|пил[аы]|станок|станки|лобзик[а-яё]*|триммер[а-яё]*|гайков[её]рт[а-яё]*|бензопил[а-яё]*|электропил[а-яё]*|мойк[а-яё]*|компрессор[а-яё]*|генератор[а-яё]*|культиватор[а-яё]*|газонокосилк[а-яё]*)(?=\s|$)/iu;

export function isAccessory(name: string): boolean {
  // «Комплект для перемещения авто (… адаптеров)» is not an adapter: only the
  // words naming the item — before its «для» — count.
  const marker = NAME_MARKER.exec(name);
  const text = (marker ? name.slice(0, marker.index) : name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  const accessory = ACCESSORY.exec(text);
  const tool = TOOL.exec(text);
  // A tool sold "с аккумулятором" is not itself an accessory.
  return Boolean(accessory && (!tool || accessory.index < tool.index));
}

const TEXT_MARKER =
  /(?:^|\s)(?:подходит\s+(?:для|к)|совместим(?:а|о|ы|ый|ая|ое|ые)?\s+с|совместимость\s*[:：-]?|для\s+модел(?:и|ей)|предназначен(?:а|о|ы)?\s+для|применяется\s+(?:для|с)|используется\s+(?:для|с))\s*/iu;
const SENTENCE_NEGATION =
  /(?:^|[^\p{L}])(?:не|кроме|исключая|несовместим\p{L}*)(?=[^\p{L}]|$)|\b(?:not|except|excluding)\b/iu;
// An explicit "does not fit" anywhere makes the supplier's text contradictory.
const INCOMPATIBLE =
  /не\s+(?:подходит|совместим)|несовместим|\bnot\s+(?:compatible|suitable)\b/iu;
// Words between the marker and the brand: «для аккумуляторной дрели Makita».
const LEADING_WORDS = /^(?:(?:[а-яё]+-)?[а-яё]+\s+){0,4}/u;
// «0,019» is a number, «446,VC2012L» and «2015-1, 2015-2» are lists.
const LIST_SEPARATOR =
  /\s*(?:,\s+|,(?!\d)|(?<!\d),|\s+и\s+|\s+and\s+|\s+\/\s+)\s*/iu;

function sentenceReferences(
  tail: string,
  matcher: BrandMatcher,
  field: ModelReference['field'],
  ownBrand: RelationBrand | undefined,
): ModelReference[] {
  const body = tail.replace(LEADING_WORDS, '');
  const found: ModelReference[] = [];
  // «Шина MAKITA для SP 6000»: a maker's part names only the model.
  let brand: RelationBrand | undefined = ownBrand;
  let previous: string[] | undefined;
  for (const [index, rawPart] of body.split(LIST_SEPARATOR).entries()) {
    let part = rawPart.trim();
    const hit = matcher.at(part);
    if (hit) {
      brand = hit.brand;
      part = part.slice(hit.length).trim();
    } else if (index === 0 && !brand) {
      return []; // no brand, no claim: «Подходит для VX100»
    }
    const { parts } = readRun(tokenize(part), 0);
    if (!parts.length) break; // prose: «и других моделей»
    let codeParts = parts;
    // «GAS 15, 12-25» — the series is carried, the number is the model.
    if (!hit && /^\d/.test(parts[0]) && previous) {
      const series = previous.slice(
        0,
        previous.findIndex((piece) => /\d/.test(piece)),
      );
      if (series.length) codeParts = [...series, ...parts];
    }
    const codes = referenceCodes(codeParts);
    if (!codes.length || !brand) break;
    found.push({ brandId: brand.id, codes, field });
    previous = codeParts;
  }
  return found;
}

/**
 * Explicit positive claims with a named brand and model: «Фильтр для пылесоса
 * BULL AS 3001», «Подходит для Makita DF 333, DF 330». No brand guessing, no
 * families, no "fits all".
 */
export function extractModelReferences(
  product: AccessoryEvidence,
  brands: RelationBrand[] | BrandMatcher,
): ModelReference[] {
  const matcher = Array.isArray(brands) ? createBrandMatcher(brands) : brands;
  const locked = product.aiLockedFields ?? [];
  const name = locked.includes('name') ? product.sourceName : product.name;
  if (!name || !isAccessory(name)) return [];
  const texts: Array<[ModelReference['field'], string]> = [
    ['name', name],
    ['descriptionShort', product.descriptionShort ?? ''],
    ['descriptionFull', product.descriptionFull ?? ''],
  ];
  const evidence = texts.filter(
    ([field]) => field === 'name' || !locked.includes(field),
  );
  if (evidence.some(([, text]) => INCOMPATIBLE.test(text))) return [];

  // «Шприц для масла Petropump PP100308»: the code after «для» is the item's
  // own article, not a tool it fits.
  const ownCodes = [product.sku, product.model]
    .map((value) => modelCode(value))
    .filter((code): code is string => Boolean(code));
  const isOwn = (reference: ModelReference) =>
    reference.codes.some((code) =>
      ownCodes.some((own) => own.startsWith(code) || code.startsWith(own)),
    );

  const ownBrandName = matcher.name(product.brandId ?? null);
  const ownBrand =
    product.brandId && ownBrandName
      ? { id: product.brandId, name: ownBrandName }
      : undefined;

  const references = new Map<string, ModelReference>();
  for (const [field, raw] of evidence) {
    const text = raw.slice(0, MAX_TEXT_LENGTH);
    // Clause boundaries stop a brand carrying over into unrelated prose.
    // «18.0 В» is not a sentence end; «VX100. Далее» is.
    const sentences =
      field === 'name'
        ? [text]
        : text.split(/(?<!\d)\.|\.(?=\s+[А-ЯЁA-Z])|[!?;\n\r]/u);
    if (raw.length > MAX_TEXT_LENGTH) sentences.pop();
    for (const sentence of sentences) {
      if (SENTENCE_NEGATION.test(sentence)) continue;
      const marker = (field === 'name' ? NAME_MARKER : TEXT_MARKER).exec(
        sentence,
      );
      if (!marker) continue;
      const tail = sentence.slice(marker.index + marker[0].length);
      for (const reference of sentenceReferences(
        tail,
        matcher,
        field,
        ownBrand,
      )) {
        if (isOwn(reference)) continue;
        const key = `${reference.brandId}:${reference.codes[0]}`;
        if (!references.has(key)) references.set(key, reference);
        if (references.size >= MAX_REFERENCES) return [...references.values()];
      }
    }
  }
  return [...references.values()];
}

/* ---- Tools --------------------------------------------------------------- */

const OWN_NAME_END =
  /(?:^|[\s(])(?:для|к|под|на|подходит|совместим[а-яё]*)(?=\s|$)/iu;

/**
 * The tool's own model codes: from its name before any «для …» (that part is
 * someone else's model), plus a sku/model column that is a model code.
 */
export function ownModelCodes(
  product: Pick<TargetIdentity, 'name' | 'model' | 'sku' | 'brandId'>,
  brandName?: string,
): string[] {
  const end = OWN_NAME_END.exec(product.name);
  const head = end ? product.name.slice(0, end.index) : product.name;
  const brandWords = new Set(
    tokenize(brandName ?? '').map((word) => fold(word.toUpperCase())),
  );
  const tokens = tokenize(head).filter(
    (token) => !brandWords.has(fold(token.toUpperCase())),
  );
  const codes = new Set<string>();
  for (let index = 0; index < tokens.length; ) {
    const { parts, end: next } = readRun(tokens, index);
    for (const code of leadingVariants(parts)) codes.add(code);
    index = next;
  }
  // An accessory's article («фильтр … JA-3808AN») is not a tool's model.
  if (!end || !isAccessory(product.name))
    for (const value of [product.model, product.sku]) {
      const code = modelCode(value);
      if (code) codes.add(code);
    }
  return [...codes];
}

/**
 * Exact model first; failing that, the model's kits («DF333» → «DF333DWYE»,
 * «DF333DZ») — a suffix that starts with a letter. «VX100» never reaches
 * «VX1000». Fallback spellings are tried only when the full one found nothing.
 */
export function matchReference<T extends TargetIdentity>(
  reference: ModelReference,
  candidates: Array<{ target: T; codes: string[] }>,
): T[] {
  const own = candidates.filter(
    ({ target }) => target.brandId === reference.brandId,
  );
  for (const code of reference.codes) {
    const exact = own.filter(({ codes }) => codes.includes(code));
    const matched = exact.length
      ? exact
      : own.filter(({ codes }) =>
          codes.some(
            (value) =>
              value.length > code.length &&
              value.startsWith(code) &&
              /[A-Z]/.test(value[code.length]),
          ),
        );
    if (matched.length)
      return matched
        .map(({ target }) => target)
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id),
        )
        .slice(0, MAX_TARGETS_PER_REFERENCE);
  }
  return [];
}

/** Cyrillic lookalikes → Latin, spaces and hyphens dropped: SQL translate(). */
export const FOLD_FROM = 'АВЕКМНОРСТХУ -‐‑';
export const FOLD_TO = 'ABEKMHOPCTXY';

/**
 * LIKE pattern every spelling of the reference satisfies in the tool's
 * upper-cased, folded text («BULL BAS 2223» → «%BAS2223%») — the SQL
 * prefilter; matchReference() decides.
 */
export function referencePattern(reference: ModelReference): string {
  const shortest = reference.codes.reduce((a, b) =>
    b.length < a.length ? b : a,
  );
  return `%${shortest}%`;
}
