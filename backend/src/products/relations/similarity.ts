import { nameSimilarity, normalizeName } from '../../offers/product-matching';
import {
  isIdentitySpec,
  isOffByDefaultSpec,
} from '../../parser/spec-filterable';

type SimilarityProduct = {
  id: string;
  name: string;
  categoryId: string;
  brandId: string | null;
  brand: { name: string } | null;
  priceValue: number | null;
  priceCurrency: string | null;
  productSpecs: Array<{
    valueNorm: string | null;
    specification: { canonicalKey: string | null; name: string };
  }>;
};

const TYPES: Array<[string, RegExp]> = [
  ['дрель', /^дрел[ьи]$/u],
  ['шуруповерт', /^шуруповерт[а-я]*$/u],
  ['гайковерт', /^гайковерт[а-я]*$/u],
  ['перфоратор', /^перфоратор[а-я]*$/u],
  ['пылесос', /^пылесос[а-я]*$/u],
  ['шлифмашина', /^(?:шлифмашин|болгарк)[а-я]*$/u],
  ['пила', /^пил[аы]$/u],
  ['лобзик', /^лобзик[а-я]*$/u],
  ['триммер', /^триммер[а-я]*$/u],
  ['фильтр', /^фильтр[а-я]*$/u],
  ['аккумулятор', /^аккумулятор(?:ы|а|ов)?$/u],
  ['зарядное устройство', /^зарядное$/u],
  ['сверло', /^сверл[а-я]*$/u],
  ['бур', /^бур(?:ы|а|ов)?$/u],
  ['диск', /^диск(?:и|а|ов)?$/u],
  ['цепь', /^цеп[ьи]$/u],
  ['нож', /^нож(?:и|а|ей)?$/u],
  ['насадка', /^насадк[а-я]*$/u],
  ['адаптер', /^адаптер[а-я]*$/u],
  ['ключ', /^ключ[а-я]*$/u],
  ['головка', /^голов(?:к[а-я]*|ок)$/u],
  ['отвертка', /^отвертк[а-я]*$/u],
  ['бита', /^бит(?:а|ы|у)?$/u],
];

// Abbreviations and qualifiers that open a name without naming the item.
const NOT_A_KIND = new Set([
  'аккум',
  'электр',
  'электро',
  'бензо',
  'пневмо',
  'проф',
  'новый',
  'new',
  'для',
  'под',
  'без',
  'при',
]);
// «Строительный», «Пильная», «Монтажное» describe; «Соединение» names.
const ADJECTIVE = /(?:ый|ий|ой|ая|яя|ое|ые)$/u;
const ENDING = /(?:ами|ями|ов|ев|ей|ах|ях|ы|и|а|я|у|ю|е|о)$/u;

/**
 * The kind of item: the first noun of its name («Анкер забиваемый …» →
 * «анкер», «Гайки М6» → «гайк»), normalised through TYPES («дрели» →
 * «дрель»). Adjectives, abbreviations, Latin words and the brand never decide
 * it — and neither does a noun further on: «Шуруп … полусф. головка» is a
 * screw, «Мешок для пылесоса» is not a vacuum cleaner.
 */
export function productKind(
  product: Pick<SimilarityProduct, 'name' | 'brand'>,
): string {
  return kindOf(product).kind;
}

/**
 * The kind, and the stem of the word that named it («Бирка для ключей» →
 * «бирк»): what a search for the same kind elsewhere in the catalogue looks
 * for in other names. Empty when the name has no kind.
 */
export function productKindStem(
  product: Pick<SimilarityProduct, 'name' | 'brand'>,
): string {
  return kindOf(product).stem;
}

function kindOf(product: Pick<SimilarityProduct, 'name' | 'brand'>): {
  kind: string;
  stem: string;
} {
  const brandWords = new Set(
    normalizeName(product.brand?.name ?? '').split(' '),
  );
  const ordered = (
    product.name
      .toLowerCase()
      .replace(/ё/g, 'е')
      .match(/[a-zа-я]{3,}/gu) ?? []
  ).filter((value) => !brandWords.has(value));
  let set = false;
  for (const word of ordered) {
    if (word === 'набор' || word === 'комплект') {
      set = true;
      continue;
    }
    if (!/^[а-я]+$/u.test(word) || NOT_A_KIND.has(word) || ADJECTIVE.test(word))
      continue;
    const type = TYPES.find(([, pattern]) => pattern.test(word));
    const bare = word.replace(ENDING, '');
    const kind = type ? type[0] : word.length > 4 ? bare : word;
    // For the search elsewhere: «биты» and «бита» both contain «бит».
    const stem = bare.length >= 3 ? bare : word;
    return { kind: `${set ? 'набор ' : ''}${kind}`, stem };
  }
  return { kind: '', stem: '' };
}

/**
 * The numbers of a name — diameters, lengths, drives («Круг отрезной 100 мм»
 * → 100; «1/2", 24 мм» → 1/2, 24). A 100 mm disc for a mini grinder is not
 * like a 230 mm one however alike the names read.
 */
function sizeTokens(name: string): Set<string> {
  return new Set(
    (name.toLowerCase().match(/\d+(?:[.,/]\d+)?/g) ?? [])
      .map((token) => token.replace(',', '.'))
      // Article numbers and years are not sizes.
      .filter((token) => token.length <= 5),
  );
}

/** Words that say nothing about what an item is for. */
const DETAIL_NOISE = new Set([
  'для',
  'под',
  'на',
  'по',
  'из',
  'от',
  'со',
  'без',
  'шт',
  'уп',
  'мм',
  'см',
  'кг',
  'мл',
  'вт',
  'комплект',
  'набор',
  'пр',
  'тип',
  'цвет',
]);

/**
 * What an item is beyond its kind — its brand, model, purpose («Адаптер для
 * предфильтра 6101 Jeta Safety» → предф, 6101, jeta, safet). Long words are
 * cut to five letters, so «барашковые» and «барашковая» meet.
 */
function detailTokens(name: string, kindStem: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(' ')
      .filter(
        (word) =>
          word &&
          !DETAIL_NOISE.has(word) &&
          !(kindStem && word.startsWith(kindStem)),
      )
      .map((word) => (word.length >= 6 ? word.slice(0, 5) : word)),
  );
}

/**
 * Another category's item of the same kind is like this one only when they
 * share a detail: «Адаптер для бит» is an adapter, but not like an adapter
 * for a respirator filter. Inside the product's own category the shelf
 * already says what it is for.
 */
function sharesDetail(left: string, right: string, kindStem: string): boolean {
  const a = detailTokens(left, kindStem);
  for (const token of detailTokens(right, kindStem))
    if (a.has(token)) return true;
  return false;
}

function sizeAgreement(left: string, right: string): number | null {
  const a = sizeTokens(left);
  const b = sizeTokens(right);
  if (!a.size || !b.size) return null;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.max(a.size, b.size);
}

function properties(product: SimilarityProduct): Map<string, string> {
  return new Map(
    product.productSpecs
      .filter(
        ({ valueNorm, specification: spec }) =>
          valueNorm &&
          spec.canonicalKey &&
          !isIdentitySpec(spec.name) &&
          !isOffByDefaultSpec(spec.name),
      )
      .map(({ valueNorm, specification }) => [
        specification.canonicalKey!,
        valueNorm!,
      ]),
  );
}

/**
 * 0 = not similar: another kind of item, or itself. `anyCategory` lets a
 * candidate from another branch of the catalogue in (the same kind filed
 * elsewhere), scored a little lower than one from the product's own.
 */
export function similarityScore(
  product: SimilarityProduct,
  candidate: SimilarityProduct,
  options: { anyCategory?: boolean } = {},
): number {
  const kind = productKind(product);
  const sameCategory = product.categoryId === candidate.categoryId;
  if (
    product.id === candidate.id ||
    (!sameCategory && !options.anyCategory) ||
    !kind ||
    kind !== productKind(candidate) ||
    (!sameCategory &&
      !sharesDetail(product.name, candidate.name, kindOf(product).stem))
  )
    return 0;
  const title = nameSimilarity(product.name, candidate.name);
  const left = properties(product);
  const right = properties(candidate);
  let shared = 0;
  let comparable = 0;
  for (const [key, value] of left) {
    if (right.has(key)) {
      comparable += 1;
      if (right.get(key) === value) shared += 1;
    }
  }
  const specs = comparable ? shared / comparable : 0;
  const price =
    product.priceCurrency &&
    product.priceCurrency === candidate.priceCurrency &&
    product.priceValue &&
    candidate.priceValue
      ? Math.min(product.priceValue, candidate.priceValue) /
        Math.max(product.priceValue, candidate.priceValue)
      : 0;
  // Names without numbers say nothing about size: neutral, not a penalty.
  const sizes = sizeAgreement(product.name, candidate.name) ?? 0.5;
  const score =
    title * 0.35 +
    specs * 0.35 +
    sizes * 0.15 +
    price * 0.1 +
    (product.brandId && product.brandId === candidate.brandId ? 0.05 : 0);
  // Zero means «not similar» to the caller, so a same-kind item never drops
  // to it; another category ranks under the product's own.
  return Math.max(0.001, sameCategory ? score : score * 0.8);
}
