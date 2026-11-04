/**
 * Characteristics an admin declared one filter (accepted from the AI
 * assistant's «одна характеристика под разными названиями»): canonical key →
 * the key and label it is folded into. Stored in `SiteSetting spec.aliases`;
 * the nightly normalizer applies it after `canonicalSpec()`, so the fold
 * survives every re-run, and `mergeDuplicateSpecifications` then folds the
 * rows of one category that now share a key.
 *
 * Pure — unit-tested.
 */
export const SPEC_ALIASES_SETTING = 'spec.aliases';

export type SpecAlias = { key: string; name: string };
export type SpecAliases = Record<string, SpecAlias>;

/** The unit part of a canonical key: `ves~kg` → `kg`, `cvet` → ''. */
export function unitOfKey(key: string): string {
  const index = key.indexOf('~');
  return index < 0 ? '' : key.slice(index + 1);
}

/** Parsed and cleaned: string keys and names only, no self-aliases. */
export function parseSpecAliases(raw: string | null | undefined): SpecAliases {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? '{}');
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: SpecAliases = {};
  for (const [from, target] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!target || typeof target !== 'object') continue;
    const { key, name } = target as { key?: unknown; name?: unknown };
    if (typeof key !== 'string' || typeof name !== 'string') continue;
    if (!key.trim() || key === from) continue;
    out[from] = { key: key.trim(), name: name.trim() || key.trim() };
  }
  return out;
}

/**
 * Follows a chain (a → b, b → c) to its end, so folding into a key that was
 * itself folded later still lands on the survivor. A loop stops where it
 * started repeating.
 */
export function resolveSpecAlias(
  key: string,
  aliases: SpecAliases,
): SpecAlias | null {
  let current: SpecAlias | null = null;
  const seen = new Set<string>([key]);
  let next = aliases[key];
  while (next && !seen.has(next.key)) {
    current = next;
    seen.add(next.key);
    next = aliases[next.key];
  }
  return current;
}

/**
 * Adds a fold of `from` keys into `to`. Refuses a fold across units — `Длина,
 * мм` and `Длина, м` are deliberately two filters — and returns the new map.
 */
export function addSpecAliases(
  aliases: SpecAliases,
  from: string[],
  to: SpecAlias,
): SpecAliases {
  const unit = unitOfKey(to.key);
  const next = { ...aliases };
  for (const key of from) {
    if (key === to.key) continue;
    if (unitOfKey(key) !== unit) {
      throw new Error(`«${key}» и «${to.key}» — разные единицы измерения`);
    }
    next[key] = { key: to.key, name: to.name };
  }
  // The survivor's own label follows the chosen name too.
  return next;
}
