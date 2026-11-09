import { variantName } from '../products/relations/variants';
import type { Rejections } from './ai-validate';

/**
 * What a model is given before it writes, so the first answer is already
 * right instead of being caught afterwards (bench 2026-11-09, 30 cards: the
 * old prompt put the supplier's text in the very field to be written — the
 * model edited it, a full description came out a median 73% unique and the
 * variants of one line 79% alike, since nothing told it what tells them apart).
 *
 * - The texts the rewrite replaces travel as `source*` keys, never under the
 *   field's own name: they are where the facts are, not a draft.
 * - A variant of a product line carries `line`: what this one is
 *   (`thisVariant`) and its siblings — the sizes are read from the names the
 *   same way the size switch reads them (`variants.ts`). The siblings' numbers
 *   are *not* facts of this card: `ai-validate.ts` still checks against the
 *   card's own data only.
 * - A field that fails a check is asked again once, with the reason and the
 *   copied pieces (`repairMessage`), before it is refused.
 */

/** Prompt keys the prose an entity has now travels under. */
export const SOURCE_KEYS = {
  descriptionShort: 'sourceShort',
  descriptionFull: 'sourceDescription',
  description: 'sourceDescription',
} as const;

/** Explains the data keys; part of the fixed «Формат ответа» block. */
export const BRIEF_FORMAT_LINES = [
  `- "sourceShort", "sourceDescription" во входных данных — нынешний текст поставщика: источник фактов, не черновик. Не пересказывай его и не повторяй его фразы подряд — напиши своё, сохранив факты и числа.`,
  `- "line" — у товара есть соседние размеры: "thisVariant" — чем именно этот отличается, "otherVariants" — соседи. Назови отличие в первой фразе описаний естественно, через сам товар («Шарошка диаметром 8 мм…»), без слов «вариант» и «линейка»; числа и размеры соседей в текст не переноси.`,
];

const MAX_SIBLINGS = 8;

export type LineInfo = { thisVariant: string; otherVariants: string[] };

/**
 * The card's place in its line from the names (the supplier's name when AI
 * rewrote ours — that is what `ProductFamily.keyName` holds). Null when the
 * name carries no sizes or there is no sibling with other sizes.
 */
export function lineInfo(
  ownName: string,
  siblingNames: string[],
): LineInfo | null {
  const own = variantName(ownName);
  if (!own) return null;
  const others = siblingNames
    .map((name) => variantName(name))
    .filter(
      (v): v is NonNullable<typeof v> =>
        Boolean(v) &&
        v!.template === own.template &&
        v!.values.length === own.values.length,
    );
  // Only the sizes that tell the variants apart: a shank all of them share
  // is not what this one is.
  const differs = own.values.map((value, i) =>
    others.some((o) => o.values[i] !== value),
  );
  const label = (values: string[]) =>
    values.filter((_, i) => differs[i]).join(' / ');
  const mine = label(own.values);
  if (!mine) return null;
  const labels: string[] = [];
  for (const o of others) {
    const l = label(o.values);
    if (l && l !== mine && !labels.includes(l)) labels.push(l);
    if (labels.length >= MAX_SIBLINGS) break;
  }
  return labels.length ? { thisVariant: mine, otherVariants: labels } : null;
}

/** One failed field for the repair request. */
export type RepairNote = {
  id: string;
  field: string;
  reason: string;
  /** Pieces copied from the supplier's text, for a uniqueness failure. */
  copied?: string[];
};

/**
 * The follow-up turn after the model's own answer: only the failed fields,
 * each with its reason. It extends the same conversation, so DeepSeek bills
 * the whole first exchange as a cached prefix.
 */
export function repairMessage(notes: RepairNote[]): string {
  const lines = notes.map((n) => {
    const copied = n.copied?.length
      ? ` Повторены куски текста поставщика: ${n.copied.map((c) => `«${c}»`).join(', ')} — скажи это своими словами.`
      : '';
    return `- id ${n.id}, поле "${n.field}": ${n.reason}.${copied}`;
  });
  return [
    'Эти поля не прошли проверку. Перепиши только их, соблюдая все правила задания и только факты из входных данных:',
    ...lines,
    'Ответь тем же JSON {"items":[...]} — только эти id и только эти поля.',
  ].join('\n');
}

/** The fields worth a second try — all but the ones the model cannot fix by rewording. */
export function repairNotes(
  id: string,
  rejected: Rejections,
  copied: Record<string, string[]> = {},
): RepairNote[] {
  return Object.entries(rejected).map(([field, reason]) => ({
    id,
    field,
    reason,
    copied: copied[field],
  }));
}
