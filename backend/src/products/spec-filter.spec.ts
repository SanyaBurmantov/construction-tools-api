import { parseSpecFilter, stringifySpecFilter } from './spec-filter';

describe('parseSpecFilter', () => {
  it('parses one specification with one value', () => {
    expect(parseSpecFilter('spec-1:750 Вт')).toEqual([
      { specificationId: 'spec-1', values: ['750 Вт'] },
    ]);
  });

  it('treats commas inside a specification as alternatives', () => {
    expect(parseSpecFilter('spec-1:750 Вт,900 Вт')).toEqual([
      { specificationId: 'spec-1', values: ['750 Вт', '900 Вт'] },
    ]);
  });

  it('parses several specifications', () => {
    expect(parseSpecFilter('spec-1:750 Вт;spec-2:220 В')).toEqual([
      { specificationId: 'spec-1', values: ['750 Вт'] },
      { specificationId: 'spec-2', values: ['220 В'] },
    ]);
  });

  it('merges a repeated specification instead of overwriting it', () => {
    expect(parseSpecFilter('spec-1:750 Вт;spec-1:900 Вт')).toEqual([
      { specificationId: 'spec-1', values: ['750 Вт', '900 Вт'] },
    ]);
  });

  it('drops duplicate values', () => {
    expect(parseSpecFilter('spec-1:750 Вт,750 Вт')).toEqual([
      { specificationId: 'spec-1', values: ['750 Вт'] },
    ]);
  });

  it('trims surrounding whitespace', () => {
    expect(parseSpecFilter(' spec-1 : 750 Вт , 900 Вт ')).toEqual([
      { specificationId: 'spec-1', values: ['750 Вт', '900 Вт'] },
    ]);
  });

  // The parameter arrives straight from a URL, so malformed input is expected.
  it('ignores malformed chunks rather than throwing', () => {
    expect(parseSpecFilter('rubbish')).toEqual([]);
    expect(parseSpecFilter(':750')).toEqual([]);
    expect(parseSpecFilter('spec-1:')).toEqual([]);
    expect(parseSpecFilter(';;;')).toEqual([]);
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
    const raw = 'spec-1:750 Вт,900 Вт;spec-2:220 В';
    expect(stringifySpecFilter(parseSpecFilter(raw))).toBe(raw);
  });

  it('skips selections that lost all their values', () => {
    expect(
      stringifySpecFilter([
        { specificationId: 'a', values: [] },
        { specificationId: 'b', values: ['x'] },
      ]),
    ).toBe('b:x');
  });
});
