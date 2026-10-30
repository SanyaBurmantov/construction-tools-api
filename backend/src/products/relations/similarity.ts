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
    const kind = type
      ? type[0]
      : word.length > 4
        ? word.replace(ENDING, '')
        : word;
    return `${set ? 'набор ' : ''}${kind}`;
  }
  return '';
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

export function similarityScore(
  product: SimilarityProduct,
  candidate: SimilarityProduct,
): number {
  const kind = productKind(product);
  if (
    product.id === candidate.id ||
    product.categoryId !== candidate.categoryId ||
    !kind ||
    kind !== productKind(candidate)
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
  return (
    title * 0.45 +
    specs * 0.4 +
    price * 0.1 +
    (product.brandId && product.brandId === candidate.brandId ? 0.05 : 0)
  );
}
