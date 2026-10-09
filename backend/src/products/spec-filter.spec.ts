import { parseSpecFilter, stringifySpecFilter } from './spec-filter';

/** Real canonical keys, so the tests document the real parameter format. */
const POWER = 'moshchnost~vt';
const VOLTAGE = 'napryazhenie~v';

describe('parseSpecFilter', () => {
  it('parses one specification with one value', () => {
    expect(parseSpecFilter(`${POWER}:750`)).toEqual([
      { specKey: POWER, values: ['750'] },
    ]);
  });

  it('treats commas inside a specification as alternatives', () => {
    expect(parseSpecFilter(`${POWER}:750,900`)).toEqual([
      { specKey: POWER, values: ['750', '900'] },
    ]);
  });

  it('parses several specifications', () => {
    expect(parseSpecFilter(`${POWER}:750;${VOLTAGE}:220`)).toEqual([
      { specKey: POWER, values: ['750'] },
      { specKey: VOLTAGE, values: ['220'] },
    ]);
  });

  it('merges a repeated specification instead of overwriting it', () => {
    expect(parseSpecFilter(`${POWER}:750;${POWER}:900`)).toEqual([
      { specKey: POWER, values: ['750', '900'] },
    ]);
  });

  it('drops duplicate values', () => {
    expect(parseSpecFilter(`${POWER}:750,750`)).toEqual([
      { specKey: POWER, values: ['750'] },
    ]);
  });

  it('trims surrounding whitespace', () => {
    expect(parseSpecFilter(` ${POWER} : 750 , 900 `)).toEqual([
      { specKey: POWER, values: ['750', '900'] },
    ]);
  });

  it('lowercases the key, so a hand-typed URL still matches', () => {
    expect(parseSpecFilter('Moshchnost~VT:750')).toEqual([
      { specKey: POWER, values: ['750'] },
    ]);
  });

  // The parameter arrives straight from a URL, so malformed input is expected.
  it('ignores malformed chunks rather than throwing', () => {
    expect(parseSpecFilter('rubbish:')).toEqual([]);
    expect(parseSpecFilter(':750')).toEqual([]);
    expect(parseSpecFilter(`${POWER}:`)).toEqual([]);
    expect(parseSpecFilter(';;;')).toEqual([]);
  });

  // Canonical keys are ASCII by construction, so a key that is not cannot name
  // one. Dropping it keeps a crafted parameter out of the query entirely.
  it('drops a key that cannot be a canonical key', () => {
    expect(parseSpecFilter('Мощность:750')).toEqual([]);
    expect(parseSpecFilter("spec' OR 1=1:750")).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(parseSpecFilter('')).toEqual([]);
    expect(parseSpecFilter(undefined)).toEqual([]);
    expect(parseSpecFilter(null)).toEqual([]);
  });

  // A crafted URL must not turn into an unbounded query.
  it('caps the number of specifications and values', () => {
    const manySpecs = Array.from({ length: 50 }, (_, i) => `s${i}:v`).join(';');
    expect(parseSpecFilter(manySpecs)).toHaveLength(20);

    const manyValues = `s1:${Array.from({ length: 100 }, (_, i) => `v${i}`).join(',')}`;
    expect(parseSpecFilter(manyValues)[0].values).toHaveLength(40);
  });
});

describe('stringifySpecFilter', () => {
  it('round-trips a parsed filter', () => {
    const raw = `${POWER}:750,900;${VOLTAGE}:220`;
    expect(stringifySpecFilter(parseSpecFilter(raw))).toBe(raw);
  });

  it('skips selections that lost all their values', () => {
    expect(
      stringifySpecFilter([
        { specKey: 'a', values: [] },
        { specKey: 'b', values: ['x'] },
      ]),
    ).toBe('b:x');
  });
});
