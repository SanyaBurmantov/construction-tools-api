/**
 * Do two supplier titles that share an article name different kinds of item?
 * Pure; the auto-merge (`auto-merge-plan.ts`) asks it before folding cards.
 *
 * Calibrated on the 1 901 barcode / brand+sku groups of the real catalogue
 * (2026-11-23). Plain token similarity is useless here: th-tool drops the
 * brand and lists the specs, b2bit names a thing in two words («Набор ключей
 * WorkPro WP222004» vs dukon's «Ключи 6-гранные 9шт в держателе»), so most
 * true pairs score low. What does tell them apart is the **head noun** — the
 * first noun of the title, what the thing is: «Домкрат» vs «Расширитель»
 * (Forsage F7205), «Индикатор» vs «Микрометр» (F-01729), «Ключ
 * динамометрический» vs «Трубогиб» (F-1202). A conflict is when neither
 * title mentions the other's head noun (by a 4-letter stem, or a synonym
 * suppliers use for the same thing). It flagged 16 of 1 901 groups, about a
 * third clearly different items and the rest borderline — a list for a
 * human, never a reason to merge or not on its own.
 */

/** Adjective and participle endings: «Гидравлический», «Отрезной», «Угловая». */
const ADJECTIVE = /(ый|ий|ой|ая|яя|ое|ее|ые|ие|ых|их|ого|его|ым|им)$/;

/** Words that name a packaging or a count, never the item. */
const NOT_A_KIND = new Set([
  'для',
  'без',
  'под',
  'над',
  'при',
  'комплект',
  'набор',
  'шт',
  'арт',
  'мм',
  'см',
  'аккум',
]);

/** Different words suppliers use for one kind of item (stem prefixes). */
const SYNONYMS: string[][] = [
  ['круг', 'диск'],
  ['стамес', 'долот'],
  ['плоског', 'пассат'],
  ['шлиф', 'ушм', 'болгар'],
  ['чемод', 'кейс', 'ящик'],
  ['клещ', 'съемн', 'ключ'],
  ['стяжк', 'съемн'],
  ['зажим', 'захват'],
  ['бит', 'отверт'],
  ['оснаст', 'бит', 'сверл'],
];

const normalize = (text: string) => text.toLowerCase().replace(/ё/g, 'е');

const words = (text: string) =>
  normalize(text)
    .split(/[^a-zа-я]+/)
    .filter((word) => word.length >= 3);

/** What the thing is: the first Russian word that is not an adjective. */
export function headNoun(title: string): string | null {
  for (const word of words(title)) {
    if (!/^[а-я]+$/.test(word)) continue;
    if (NOT_A_KIND.has(word) || ADJECTIVE.test(word)) continue;
    return word;
  }
  return null;
}

const stem = (word: string) => word.slice(0, 4);

function mentions(title: string, kind: string): boolean {
  const text = normalize(title);
  if (text.includes(stem(kind))) return true;
  return SYNONYMS.some(
    (group) =>
      group.some((word) => kind.startsWith(word)) &&
      group.some((word) => text.includes(word)),
  );
}

export function namesDifferentKinds(a: string, b: string): boolean {
  const kindA = headNoun(a);
  const kindB = headNoun(b);
  if (!kindA || !kindB) return false;
  return !mentions(b, kindA) && !mentions(a, kindB);
}
