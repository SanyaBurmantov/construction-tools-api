const RU_TO_LAT: Record<string, string> = {
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
  й: 'y',
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
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

// longest sequences first so 'sch'/'sh' win over 's'
const LAT_TO_RU: Array<[string, string]> = [
  ['shch', 'щ'],
  ['sch', 'щ'],
  ['yo', 'ё'],
  ['zh', 'ж'],
  ['kh', 'х'],
  ['ts', 'ц'],
  ['ch', 'ч'],
  ['sh', 'ш'],
  ['yu', 'ю'],
  ['ya', 'я'],
  ['a', 'а'],
  ['b', 'б'],
  ['c', 'к'],
  ['d', 'д'],
  ['e', 'е'],
  ['f', 'ф'],
  ['g', 'г'],
  ['h', 'х'],
  ['i', 'и'],
  ['j', 'дж'],
  ['k', 'к'],
  ['l', 'л'],
  ['m', 'м'],
  ['n', 'н'],
  ['o', 'о'],
  ['p', 'п'],
  ['q', 'к'],
  ['r', 'р'],
  ['s', 'с'],
  ['t', 'т'],
  ['u', 'у'],
  ['v', 'в'],
  ['w', 'в'],
  ['x', 'кс'],
  ['y', 'й'],
  ['z', 'з'],
];

export function ruToLat(value: string): string {
  return value
    .toLowerCase()
    .replace(/[а-яё]/g, (char) => RU_TO_LAT[char] ?? char);
}

export function latToRu(value: string): string {
  let result = value.toLowerCase();
  for (const [lat, ru] of LAT_TO_RU) {
    result = result.split(lat).join(ru);
  }
  return result;
}

/**
 * Variants of a search term to match against the catalog: the term itself
 * plus naive transliterations, so «макита» finds Makita and "bosh" has a
 * chance against «Бош». Imperfect mappings are fine — they are combined
 * with trigram similarity matching downstream.
 */
export function searchVariants(term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const variants = new Set([trimmed]);
  if (/[а-яё]/i.test(trimmed)) variants.add(ruToLat(trimmed));
  if (/[a-z]/i.test(trimmed)) variants.add(latToRu(trimmed));
  return [...variants].filter(Boolean);
}
