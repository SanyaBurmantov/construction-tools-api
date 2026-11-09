/**
 * Text uniqueness the way text.ru, Advego and Content-Watch count it — on
 * «shingles»: overlapping runs of content words. A text's uniqueness is the
 * share of its content words that no shingle of any source covers.
 *
 * Pure (texts in, numbers and spans out); finding the sources — our catalogue,
 * the suppliers' texts, pages a person names — is the service's job. Offsets
 * are JavaScript string indices (UTF-16), unlike the detector's code points,
 * so the page can slice the text with them directly.
 */

/** Shingle length in content words. 4 is the usual middle: 3 flags common
 * turns of phrase («для сверления отверстий в»), 5 misses a lightly edited copy. */
export const SHINGLE_WORDS = 4;

/** Words that carry no content; text.ru drops them before shingling too. */
const STOP_WORDS = new Set(
  (
    'и в во не на с со по к ко о об обо от до из за для у а но или либо что как это ' +
    'же ли бы то его ее их он она оно они мы вы я ты при под над без так также ' +
    'только все еще уже даже если чтобы когда где там тут этот эта эти этого этой ' +
    'том той тем те то который которая которые которого которой может можно быть ' +
    'есть был была были будет будут свой своя свои своего своей а также да нет ни ' +
    'the a an and or of to in on for with is are'
  ).split(' '),
);

export type Word = { norm: string; start: number; end: number };

export function words(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    out.push({
      norm: m[0].toLowerCase().replace(/ё/g, 'е'),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

function contentWords(all: Word[]) {
  return all.filter((w) => w.norm.length > 1 && !STOP_WORDS.has(w.norm));
}

function shingleKeys(content: Word[]): string[] {
  const keys: string[] = [];
  for (let i = 0; i + SHINGLE_WORDS <= content.length; i++) {
    keys.push(
      content
        .slice(i, i + SHINGLE_WORDS)
        .map((w) => w.norm)
        .join(' '),
    );
  }
  return keys;
}

export type UniquenessSource<T> = { text: string; meta: T };

export type UniquenessResult<T> = {
  /** 0–100, `null` when the text is too short to shingle. */
  percent: number | null;
  contentWords: number;
  /** Every source that shares at least one shingle, biggest share first. */
  sources: Array<T & { share: number }>;
  /** Copied stretches of the text, with the indexes (into `sources`) of who has them. */
  spans: Array<{ start: number; end: number; sources: number[] }>;
};

export function uniqueness<T>(
  text: string,
  sources: Array<UniquenessSource<T>>,
): UniquenessResult<T> {
  const content = contentWords(words(text));
  const keys = shingleKeys(content);
  if (!keys.length) {
    return {
      percent: null,
      contentWords: content.length,
      sources: [],
      spans: [],
    };
  }

  const coveredBy: Array<Set<number>> = content.map(() => new Set());
  const found: Array<{ meta: T; covered: number; index: number }> = [];
  sources.forEach((source) => {
    const theirs = new Set(shingleKeys(contentWords(words(source.text))));
    if (!theirs.size) return;
    const mine = new Set<number>();
    keys.forEach((key, i) => {
      if (!theirs.has(key)) return;
      for (let k = i; k < i + SHINGLE_WORDS; k++) mine.add(k);
    });
    if (!mine.size) return;
    const index = found.length;
    found.push({ meta: source.meta, covered: mine.size, index });
    for (const k of mine) coveredBy[k].add(index);
  });

  // Sources ranked by share; span source indexes follow the ranking.
  const ranked = [...found].sort((a, b) => b.covered - a.covered);
  const rank = new Map(ranked.map((f, i) => [f.index, i]));

  const spans: UniquenessResult<T>['spans'] = [];
  let open: { start: number; end: number; sources: Set<number> } | null = null;
  content.forEach((word, k) => {
    const by = coveredBy[k];
    if (!by.size) {
      if (open) spans.push(close(open));
      open = null;
      return;
    }
    if (!open) open = { start: word.start, end: word.end, sources: new Set() };
    open.end = word.end;
    for (const i of by) open.sources.add(rank.get(i)!);
  });
  if (open) spans.push(close(open));

  const covered = coveredBy.filter((s) => s.size).length;
  return {
    percent: Math.round((1 - covered / content.length) * 1000) / 10,
    contentWords: content.length,
    sources: ranked.map((f) => ({
      ...f.meta,
      share: Math.round((f.covered / content.length) * 1000) / 10,
    })),
    spans,
  };
}

function close(span: { start: number; end: number; sources: Set<number> }) {
  return {
    start: span.start,
    end: span.end,
    sources: [...span.sources].sort((a, b) => a - b),
  };
}

/**
 * Phrases to look the text up by: runs of five words written with single
 * spaces, as they appear in the text (so a verbatim copy elsewhere contains
 * them byte for byte), longer words preferred (rarer), spread over the text.
 */
export function searchPhrases(text: string, max = 6): string[] {
  const candidates: Array<{ phrase: string; at: number; score: number }> = [];
  for (const run of text.matchAll(/[\p{L}\p{N}]+(?: [\p{L}\p{N}]+){4,}/gu)) {
    const parts = run[0].split(' ');
    let offset = run.index;
    for (let i = 0; i + 5 <= parts.length; i += 5) {
      const chunk = parts.slice(i, i + 5);
      const phrase = chunk.join(' ');
      const content = chunk.filter(
        (w) => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()),
      );
      if (phrase.length >= 28 && content.length >= 3) {
        candidates.push({
          phrase,
          at: offset,
          score: content.reduce((sum, w) => sum + w.length, 0),
        });
      }
      offset += phrase.length + 1;
    }
  }
  if (candidates.length <= max) return candidates.map((c) => c.phrase);
  // One per stretch of the text, the best-scoring in each.
  const out: string[] = [];
  const size = candidates.length / max;
  for (let b = 0; b < max; b++) {
    const bucket = candidates.slice(
      Math.floor(b * size),
      Math.floor((b + 1) * size),
    );
    const best = bucket.reduce(
      (a, c) => (c.score > a.score ? c : a),
      bucket[0],
    );
    out.push(best.phrase);
  }
  return out;
}

/** A `LIKE` pattern matching `phrase` anywhere, with its wildcards escaped. */
export function containsPattern(phrase: string) {
  return `%${phrase.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
