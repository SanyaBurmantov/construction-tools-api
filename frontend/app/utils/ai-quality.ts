import type { AiFieldQuality } from '~/types/ai'

/**
 * One line of a rewritten text's figures: «уникальность 82% · детектор 98%».
 * Uniqueness is against the old and the supplier's text (below
 * AI_MIN_UNIQUENESS the field is not written); the detector figure is for
 * comparing templates, not a verdict.
 */
export function aiQualityLine(q: AiFieldQuality | undefined | null): string {
  if (!q) return ''
  const parts: string[] = []
  if (q.uniqueness != null) parts.push(`уникальность ${q.uniqueness.toLocaleString('ru-RU')}%`)
  if (q.ai != null) parts.push(`детектор ИИ ${Math.round(q.ai * 100)}%`)
  return parts.join(' · ')
}
