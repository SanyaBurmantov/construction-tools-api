/**
 * Display typography for prose — product, category, brand and landing texts.
 * Applied **when a text is rendered**, never stored: the database keeps the
 * supplier's / the AI's text as it was, so search, the uniqueness check, the
 * AI validators and the supplier comparison all see the original. Never run
 * names, articles or models through it — «10x40» must still find «10x40».
 *
 * Conservative on purpose: only rules that cannot change meaning. Lines are
 * kept (descriptions render with `white-space: pre-line`).
 */

const NBSP = ' '

/** Words that should not end a line: prepositions, conjunctions, particles. */
const SHORT_WORDS =
  'а|в|во|и|к|ко|о|об|с|со|у|на|по|до|за|от|из|не|ни|но|да|для|без|при|под|над|про|или'

/** Units glued to their number: «10 мм», «1 200 Вт» never break apart. */
const UNITS =
  'мм|см|дм|м|км|мкм|г|кг|т|мг|л|мл|Вт|кВт|В|А|мА|Ач|А·ч|мАч|Гц|кГц|об\\/мин|уд\\/мин|' +
  'Нм|Н·м|бар|атм|МПа|кПа|Па|дБ|°C|°С|°|%|шт|мин|сек|с|ч|л\\/мин|м³\\/ч|м2|м²|м3|м³|кВА|Дж|руб|BYN|Br'

const SHORT_WORD_RE = new RegExp(`(^|[\\s(«„"—])(${SHORT_WORDS}) +`, 'giu')
const UNIT_RE = new RegExp(`(\\d) +(${UNITS})(?![\\p{L}\\p{N}])`, 'gu')

export function typograf(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .split('\n')
    .map(typografLine)
    .join('\n')
}

function typografLine(line: string): string {
  let s = line.replace(/[ \t]{2,}/g, ' ')
  s = s.replace(/\.{3}/g, '…')
  s = quotes(s)
  // A hyphen or double hyphen between spaces is a dash, kept on the line before.
  s = s.replace(/ +(?:--?|–) +/g, `${NBSP}— `)
  s = s.replace(/^(?:--?|–) +/, `—${NBSP}`)
  // Twice: «в и на» — the second word's match starts where the first ended.
  s = s.replace(SHORT_WORD_RE, `$1$2${NBSP}`).replace(SHORT_WORD_RE, `$1$2${NBSP}`)
  s = s.replace(UNIT_RE, `$1${NBSP}$2`)
  // Thousands written with a space stay together: «1 200 Вт».
  s = s.replace(/(\d) (\d{3})(?!\d)/g, `$1${NBSP}$2`)
  return s
}

/**
 * Straight double quotes to «ёлочки» — only when they pair up in the line.
 * A quote after a digit is an inch mark («ключ 1/2"») and is left alone.
 */
function quotes(line: string): string {
  const positions: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"' && !/\d/.test(line[i - 1] ?? '')) positions.push(i)
  }
  if (!positions.length || positions.length % 2) return line
  const chars = [...line]
  // `[...line]` splits by code point; map string indexes onto it.
  const index = new Map<number, number>()
  let cu = 0
  chars.forEach((ch, cp) => {
    index.set(cu, cp)
    cu += ch.length
  })
  positions.forEach((pos, n) => {
    chars[index.get(pos)!] = n % 2 === 0 ? '«' : '»'
  })
  return chars.join('')
}
