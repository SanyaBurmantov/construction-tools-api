/**
 * Phrases an admin asks for in quotes — «купить в Минске по низким ценам» —
 * pass every filter verbatim. Without this the SEO specialist's own
 * instruction was undone twice: the supplier-boilerplate cleaner cut the
 * sentence («купить … в Минске» is exactly what it strips from dukon.by), and
 * the checks refused the field for a word or number «not in the product
 * data». The admin's text *is* the data for that phrase.
 *
 * Only the task's own instructions count (`AiTask.promptParts`), never the
 * shop rules: those quote what is forbidden («лучший», «№1»).
 *
 * Pure — unit-tested.
 */

/** `{ general, fields: { key: text } }` — the admin's part of an instruction. */
export type PromptParts = {
  general?: string | null;
  fields?: Record<string, string> | null;
};

const QUOTED =
  /«([^«»\n]{3,200})»|"([^"\n]{3,200})"|“([^“”\n]{3,200})”|„([^„“\n]{3,200})“/g;

/**
 * Quoted phrases of two words or more. A single quoted word is usually an
 * example or a prohibition («не пиши "лучший"»), not text to insert.
 * Placeholders still in [скобках] are a template nobody filled in — skipped.
 */
export function quotedPhrases(parts: PromptParts | null | undefined): string[] {
  if (!parts) return [];
  const texts = [parts.general ?? '', ...Object.values(parts.fields ?? {})];
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(QUOTED)) {
      const phrase = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!/\s/.test(phrase) || /[[\]]/.test(phrase)) continue;
      found.add(phrase);
    }
  }
  // Longest first, so a phrase inside another one is not matched alone.
  return [...found].sort((a, b) => b.length - a.length);
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The phrase in any case and with any run of spaces — the model rarely keeps either. */
function phrasePattern(phrase: string) {
  return new RegExp(
    phrase
      .split(' ')
      .map((word) => escape(word).replace(/[её]/gi, '[её]'))
      .join('\\s+'),
    'giu',
  );
}

/** The text with every allowed phrase removed — what the checks look at. */
export function withoutPhrases(text: string, phrases: string[]): string {
  let out = text;
  for (const phrase of phrases) out = out.replace(phrasePattern(phrase), ' ');
  return out;
}

/**
 * Runs `clean` over the text with the allowed phrases hidden behind
 * placeholders, then puts them back. The placeholder is a private-use
 * character plus digits: no marker of the cleaner can match it, and it counts
 * as content, so a sentence that is only the phrase is not dropped as empty.
 */
export function protectPhrases(
  text: string,
  phrases: string[],
  clean: (text: string) => string,
): string {
  if (!phrases.length) return clean(text);
  const kept: string[] = [];
  let masked = text;
  for (const phrase of phrases) {
    masked = masked.replace(phrasePattern(phrase), (found) => {
      kept.push(found);
      return `${kept.length - 1}`;
    });
  }
  return clean(masked).replace(
    /(\d+)/g,
    (_, index: string) => kept[Number(index)] ?? '',
  );
}
