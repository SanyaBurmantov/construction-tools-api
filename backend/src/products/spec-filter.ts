/**
 * Parsing for the `specs` query parameter.
 *
 * Format: `<specId>:<value>,<value>;<specId>:<value>` — values inside one
 * specification are OR'ed, different specifications are AND'ed. Kept separate
 * from the service so the parsing, which comes straight from a URL, is
 * testable on its own.
 */

export type SpecSelection = { specificationId: string; values: string[] };

const MAX_SPECS = 20;
const MAX_VALUES_PER_SPEC = 40;

export function parseSpecFilter(raw?: string | null): SpecSelection[] {
  if (!raw?.trim()) return [];

  const selections = new Map<string, Set<string>>();

  for (const chunk of raw.split(';')) {
    const separator = chunk.indexOf(':');
    if (separator <= 0) continue;

    const specificationId = chunk.slice(0, separator).trim();
    if (!specificationId) continue;

    const values = chunk
      .slice(separator + 1)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) continue;

    const bucket = selections.get(specificationId) ?? new Set<string>();
    // Repeating the same id in the query merges rather than overwrites.
    values.forEach((value) => bucket.add(value));
    selections.set(specificationId, bucket);
  }

  return [...selections.entries()]
    .slice(0, MAX_SPECS)
    .map(([specificationId, values]) => ({
      specificationId,
      values: [...values].slice(0, MAX_VALUES_PER_SPEC),
    }));
}

/** Rebuilds the query string — used to compute "what if I drop this filter". */
export function stringifySpecFilter(selections: SpecSelection[]): string {
  return selections
    .filter((selection) => selection.values.length)
    .map(
      (selection) =>
        `${selection.specificationId}:${selection.values.join(',')}`,
    )
    .join(';');
}
