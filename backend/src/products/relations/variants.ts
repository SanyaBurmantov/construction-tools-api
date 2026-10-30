import { createHash } from 'node:crypto';
import { parsePack } from './packs';

/**
 * Sizes of one line on one card: «Сверло по металлу 6 мм HSS Bosch», «… 8 мм
 * …», «… 12 мм …» are one family — the brand plus the name with every size
 * masked. The pack is left out (the packs block switches packaging), power
 * tools are left out (their numbers are models and watts, not sizes), and a
 * standard's number («DIN 933») is part of the name, not a size.
 */
export const VARIANT_RULE_VERSION = 2;
/**
 * Listings read per family: STARFIX sells every bolt size in several packs,
 * so DIN 933 is ~470 cards for ~150 sizes. The size count is what is capped.
 */
export const MAX_FAMILY = 600;
const MAX_SIZES = 200;

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
// A chain element may be a fraction: «25х3/4"», «1 1/4"».
const PART = String.raw`(?:\d+\s\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)`;
const UNIT = String.raw`(?:мм|mm|см³|см3|см|cm|м²|м2|м³|м|m|"|''|”|″|дюйм|кг|г|л|мл|мкм|зуб(?:ьев|цов|\.)?|пр\.?|предм\.?|гр\.?)`;
const SIZE = new RegExp(
  [
    // 10х100х160 мм, М10х40, Ø6х80, 125x1,2x22,2
    String.raw`(?:(?:[МMØø]|PH|PZ|TX|T|Т|H|SW)\s?)?${PART}(?:\s?[хx×*]\s?${PART})+(?:\s?${UNIT})?`,
    // 1/2", 1 1/4"
    String.raw`\d+(?:\s\d+)?\/\d+\s?(?:"|''|”|″|дюйм)?`,
    // М10, PH2, PZ1, T25, TX25, SW10, H5
    String.raw`(?:[МM]|PH|PZ|РН|TORX|TX|T|Т|SW|HEX|H)\s?-?${NUMBER}`,
    // Ø6, 6 мм, 25 зуб.
    String.raw`[Øø]?\s?${NUMBER}\s?${UNIT}`,
    // a bare size: «Заглушка ВК 110»; five digits and more are codes
    String.raw`\d{1,4}(?:[.,]\d+)?(?!\d)`,
  ]
    .map((part) => `(?:${part})`)
    .join('|'),
  'gu',
);
// A number that names a standard, a class or a colour stays in the name.
const FIXED_BEFORE =
  /(?:din|гост|ост|iso|en|ral|кл\.?\s?пр\.?|класс(?:а|ом)?(?:\s+прочности)?|тип|сери[яи]|модель|№|арт\.?|art\.?)\s*$/iu;
// A model prefix in Latin capitals («HYVST SPX 1100», «LG 435»): a model.
const MODEL_BEFORE = /(?:^|\s)[A-Z][A-Z0-9-]{1,}\s$/u;
const POWER_TOOL =
  /(?:\d\s?(?:вт|w|квт|kw)(?![\p{L}])|аккум|бензо|бензин|электро|сетев|об\/мин|\dдж|\d\sдж|л\.с\.)/iu;

export type VariantName = {
  /** The name with sizes masked — the family's text. */
  template: string;
  /** The sizes in order, as written. */
  values: string[];
};

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/** The name split into its fixed text and its sizes; null for a power tool. */
export function variantName(name: string): VariantName | null {
  if (POWER_TOOL.test(name)) return null;
  const pack = parsePack(name);
  const text = pack
    ? name.replace(
        /\(\s*(?:к-т|компл\.?|упак\.?|уп\.?)?\s*\d+(?:[.,]\d+)?\s*(?:шт|кг)(?![а-яё])[^()\d]*\)/iu,
        ' ',
      )
    : name;
  const values: string[] = [];
  let template = '';
  let last = 0;
  for (const match of text.matchAll(SIZE)) {
    const start = match.index;
    const before = text.slice(0, start);
    // Inside a word or a code («AG1209», «S04H2109») — not a size.
    if (/[\p{L}\d-]$/u.test(before)) continue;
    if (/[\p{L}]$/u.test(before) || FIXED_BEFORE.test(before)) continue;
    if (/^\d/.test(match[0]) && MODEL_BEFORE.test(before)) continue;
    // Inside a code: «CS-15.50.300», «СТФ 744-1,8», «AG 1209-3».
    if (/[\p{L}\d][.-]$/u.test(before)) continue;
    const after = text.slice(start + match[0].length);
    if (/^[\p{L}\d]/u.test(after) && !/^[хx×]/u.test(after)) continue;
    // «AG 1209-3» is a model, «6-гранная» a word.
    if (/^\d+$/.test(match[0]) && /^-[\p{L}\d]/u.test(after)) continue;
    template += `${text.slice(last, start)}§`;
    values.push(clean(match[0]));
    last = start + match[0].length;
  }
  template += text.slice(last);
  template = clean(template.toLowerCase().replace(/ё/g, 'е'));
  // A family needs a name of its own around the sizes.
  if (!values.length || values.length > 6 || !/\p{L}{3,}/u.test(template))
    return null;
  return { template, values };
}

/** Family key: the brand (or the category, for unbranded goods) + template. */
export function familyKey(
  name: string,
  brandId: string | null,
  categoryId: string,
): string | null {
  const parsed = variantName(name);
  if (!parsed) return null;
  return createHash('md5')
    .update(`${brandId ?? `category:${categoryId}`}\u001f${parsed.template}`)
    .digest('hex');
}

export type VariantMember = {
  id: string;
  slug: string;
  name: string;
  priceValue: number | null;
  priceCurrency: string | null;
  stockStatus: string | null;
};

/**
 * Lean on purpose: a DIN 933 family is ~165 sizes and every one of them goes
 * into the product page's SSR payload.
 */
export type VariantOption = {
  slug: string;
  label: string;
  priceValue: number | null;
  stockStatus: string | null;
  current: boolean;
};

const numbers = (value: string) =>
  (value.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) =>
    Number(n.replace(',', '.')),
  );

/**
 * The family as switch options: labelled by the sizes that differ, one per
 * label (the current card, else the same pack as the current one, else in
 * stock and cheapest), ordered by those sizes. Fewer than two: nothing.
 */
export function variantOptions(
  current: VariantMember,
  members: VariantMember[],
): VariantOption[] {
  const own = variantName(current.name);
  if (!own) return [];
  const parsed = members
    .map((member) => ({ member, name: variantName(member.name) }))
    .filter(
      (row): row is { member: VariantMember; name: VariantName } =>
        Boolean(row.name) &&
        row.name!.template === own.template &&
        row.name!.values.length === own.values.length,
    );
  if (!parsed.some((row) => row.member.id === current.id))
    parsed.push({ member: current, name: own });
  if (parsed.length < 2 || parsed.length > MAX_FAMILY) return [];
  const differing = own.values
    .map((_, index) => index)
    .filter((index) =>
      parsed.some((row) => row.name.values[index] !== own.values[index]),
    );
  if (!differing.length) return [];
  const ownPack = parsePack(current.name)?.quantity;
  const better = (a: VariantMember, b: VariantMember) => {
    if (a.id === current.id) return true;
    if (b.id === current.id) return false;
    const samePack = (m: VariantMember) =>
      parsePack(m.name)?.quantity === ownPack;
    if (samePack(a) !== samePack(b)) return samePack(a);
    const inStock = (m: VariantMember) => m.stockStatus === 'in_stock';
    if (inStock(a) !== inStock(b)) return inStock(a);
    return (a.priceValue ?? Infinity) < (b.priceValue ?? Infinity);
  };
  const byLabel = new Map<string, { member: VariantMember; sort: number[] }>();
  for (const row of parsed) {
    // «Бита 10 мм Torx T35 30 мм»: one size written twice is one label part.
    const values = [
      ...new Set(differing.map((index) => row.name.values[index])),
    ];
    const label = values.join(' · ');
    const existing = byLabel.get(label);
    if (!existing || better(row.member, existing.member))
      byLabel.set(label, { member: row.member, sort: values.flatMap(numbers) });
  }
  if (byLabel.size < 2 || byLabel.size > MAX_SIZES) return [];
  return [...byLabel.entries()]
    .sort(([la, a], [lb, b]) => {
      for (let i = 0; i < Math.max(a.sort.length, b.sort.length); i += 1) {
        const diff = (a.sort[i] ?? -1) - (b.sort[i] ?? -1);
        if (diff) return diff;
      }
      return la.localeCompare(lb, 'ru');
    })
    .map(([label, { member }]) => ({
      slug: member.slug,
      label,
      priceValue: member.priceValue,
      // «in_stock» or nothing: the switch only dims what is not on hand.
      stockStatus: member.stockStatus === 'in_stock' ? 'in_stock' : null,
      current: member.id === current.id,
    }));
}
