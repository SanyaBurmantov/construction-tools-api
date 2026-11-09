import type { Rejections } from './ai-validate';

/**
 * Text checks on an AI rewrite that need the catalogue or the detector, so
 * they sit beside `ai-validate.ts` rather than in it. The verdicts are pure
 * and tested here; `ai-rewrite-checks.service.ts` gathers the numbers.
 *
 * Measured 2026-11-09 on 566 descriptions DeepSeek had already written:
 * against the text it replaced and the supplier's, a full description was a
 * median 74% unique and 20% of them under 50% (a reshuffled supplier text —
 * a TOPTUL key set came out 14%); short descriptions 81% and 6.5%.
 */

/** Prose fields worth a uniqueness figure (SEO lines are too short to shingle). */
export const UNIQUENESS_FIELDS = [
  'descriptionFull',
  'descriptionShort',
  'description',
] as const;

/** Below this a rewritten description is not written. `AI_MIN_UNIQUENESS=0` turns it off. */
export const DEFAULT_MIN_UNIQUENESS = 50;

export function minUniqueness(env = process.env.AI_MIN_UNIQUENESS): number {
  const value = Number(env?.trim());
  return env?.trim() && Number.isFinite(value)
    ? Math.min(Math.max(value, 0), 100)
    : DEFAULT_MIN_UNIQUENESS;
}

/** What is kept on the task item per field (`AiTaskItem.quality`). */
export type FieldQuality = {
  /** % of the new text not found in the old text or the supplier's. */
  uniqueness?: number | null;
  /** The detector's «written by a model» probability, 0–1. A figure, not a verdict. */
  ai?: number | null;
};

export type RewriteVerdict = {
  quality: Record<string, FieldQuality>;
  rejected: Rejections;
  /** Pieces copied from the old/supplier text, per field (for the repair request). */
  copied: Record<string, string[]>;
};

export function rewriteVerdict(
  figures: Record<string, FieldQuality>,
  copied: Record<string, string[]> = {},
  min = minUniqueness(),
): RewriteVerdict {
  const rejected: Rejections = {};
  for (const [field, q] of Object.entries(figures)) {
    if (min > 0 && q.uniqueness != null && q.uniqueness < min) {
      rejected[field] =
        `уникальность ${q.uniqueness}% — почти прежний текст или текст поставщика (нужно от ${min}%)`;
    }
  }
  return { quality: figures, rejected, copied };
}
