/**
 * One spelling per search, so «Бур SDS », «бур  sds» and «бур sds» are one
 * row in the report. Pure. Returns '' for something not worth logging.
 */
export const MAX_TERM_LENGTH = 120;

export function normalizeSearchTerm(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const term = raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Control characters (tabs, newlines pasted with a code) become spaces.
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TERM_LENGTH)
    .trim();
  return term.length >= 2 ? term : '';
}
