/**
 * Russian full-text search: «дрели» finds «Дрель», «ключи гаечные» finds
 * «Ключ гаечный», «перфораторы makita» finds «Перфоратор MAKITA HR 2641».
 *
 * The trigram search (`rankedMatchIds`) matches the term as one substring, so
 * a plural, another case or two words in another order found nothing:
 * measured on production 2026-11-04, «компрессоры» 0 → 678, «пилы
 * циркулярные» 0 → 73, «саморезы по дереву» 0 → 115, «ключи гаечные» 1 → 455.
 * This adds a branch where every word must match in some form (Snowball
 * stemming of the `russian` configuration; Latin words go through the English
 * stemmer), each as a prefix, so a half-typed last word already matches.
 *
 * The document is name + sku + model, with the name's first two words — the
 * kind of product, as a rule — weighted A: «Шуруповерт …» ranks above
 * «Переходник … шуруповерт-головка». It is an expression, not a column, so
 * there is no table rewrite; the GIN index in migration
 * 20261104120000_product_search_fts is on this exact expression and the
 * planner uses it only while the text stays identical (a test checks).
 */
export function ftsDocumentSql(alias?: string): string {
  const col = (name: string) => (alias ? `${alias}."${name}"` : `"${name}"`);
  return (
    `(setweight(to_tsvector('russian'::regconfig, COALESCE(substring(${col('name')} from '^\\S+(?:\\s+\\S+)?'), '')), 'A') || ` +
    `to_tsvector('russian'::regconfig, ${col('name')} || ' ' || COALESCE(${col('sku')}, '') || ' ' || COALESCE(${col('model')}, '')))`
  );
}

/** The indexed form: unqualified columns, exactly as in the migration. */
export const FTS_DOCUMENT_SQL = ftsDocumentSql();

/**
 * Words the catalogue spells differently from the buyer, and stems the
 * Russian stemmer splits (a fleeting vowel: «уровень» → уровен, «уровни» →
 * уровн). A query word starting with any prefix of a group matches every
 * prefix of it. Small on purpose: add a group when the search journal
 * (/admin/search, «ничего не найдено») shows people missing it.
 */
export const SEARCH_SYNONYMS: string[][] = [
  ['болгарк', 'ушм', 'углошлифовальн'],
  ['уровн', 'уровен'],
  ['ремн', 'ремен'],
  ['диск', 'круг'],
  ['циркулярк', 'циркулярн'],
  ['краскопульт', 'краскораспылител'],
  ['фен', 'термофен', 'термовоздуходувк'],
  ['наждак', 'точильн', 'заточн'],
  ['сварк', 'сварочн'],
  ['шлифмашин', 'шлифовальн'],
];

/** Longest first, so «углошлифовальн» wins over a shorter overlapping prefix. */
const SYNONYM_PREFIXES = SEARCH_SYNONYMS.flatMap((group) =>
  group.map((prefix) => ({ prefix, group })),
).sort((a, b) => b.prefix.length - a.prefix.length);

/** Words beyond this are not worth a query term (a pasted description). */
const MAX_WORDS = 8;

function wordGroup(word: string): string[] {
  const hit = SYNONYM_PREFIXES.find(({ prefix }) => word.startsWith(prefix));
  if (!hit) return [word];
  return [...new Set([word, ...hit.group])];
}

/**
 * The `to_tsquery('russian', …)` text for a search term, or null when nothing
 * searchable is left. Only letters and digits reach the query — the operators
 * are ours — so a term can never be a tsquery syntax error.
 */
export function buildFtsQuery(term: string): string | null {
  const words = term
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u)
    // One letter is noise («м» of «м 10»); a lone digit is a size.
    .filter((word) => word.length >= 2 || /^\d$/.test(word))
    .slice(0, MAX_WORDS);
  if (!words.length) return null;
  return [...new Set(words)]
    .map((word) => {
      const options = wordGroup(word).map((option) => `${option}:*`);
      return options.length > 1 ? `(${options.join(' | ')})` : options[0];
    })
    .join(' & ');
}
