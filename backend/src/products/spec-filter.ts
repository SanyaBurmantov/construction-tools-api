/**
 * Parsing for the `specs` query parameter.
 *
 * Format: `<specKey>:<value>,<value>;<specKey>:<value>` — values inside one
 * specification are OR'ed, different specifications are AND'ed. Kept separate
 * from the service so the parsing, which comes straight from a URL, is
 * testable on its own.
 *
 * `specKey` is the **canonical** key (`parser/spec-canonical.ts`), not a
 * `Specification.id`. It used to be the id, and that was a bug rather than a
 * detail: `Specification` is keyed by `(categoryId, key)`, so the id identified
 * one category's copy of the characteristic. Ticking "750 Вт" in a parent
 * category filtered the single subcategory whose UUID happened to be in the
 * URL and dropped the rest of the subtree.
 */

export type SpecSelection = { specKey: string; values: string[] };

const MAX_SPECS = 20;
const MAX_VALUES_PER_SPEC = 40;

/**
 * Canonical keys are `[a-z0-9~-]+` by construction. Anything else in the URL is
 * junk (or an id from a link bookmarked before the switch) and is dropped —
 * matching it would be a guaranteed empty result page.
 */
const SPEC_KEY_PATTERN = /^[a-z0-9~-]+$/;

export function parseSpecFilter(raw?: string | null): SpecSelection[] {
  if (!raw?.trim()) return [];

  const selections = new Map<string, Set<string>>();

  for (const chunk of raw.split(';')) {
    const separator = chunk.indexOf(':');
    if (separator <= 0) continue;

    const specKey = chunk.slice(0, separator).trim().toLowerCase();
    if (!specKey || !SPEC_KEY_PATTERN.test(specKey)) continue;

    const values = chunk
      .slice(separator + 1)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) continue;

    const bucket = selections.get(specKey) ?? new Set<string>();
    // Repeating the same key in the query merges rather than overwrites.
    values.forEach((value) => bucket.add(value));
    selections.set(specKey, bucket);
  }

  return [...selections.entries()]
    .slice(0, MAX_SPECS)
    .map(([specKey, values]) => ({
      specKey,
      values: [...values].slice(0, MAX_VALUES_PER_SPEC),
    }));
}

/** Rebuilds the query string — used to compute "what if I drop this filter". */
export function stringifySpecFilter(selections: SpecSelection[]): string {
  return selections
    .filter((selection) => selection.values.length)
    .map((selection) => `${selection.specKey}:${selection.values.join(',')}`)
    .join(';');
}
