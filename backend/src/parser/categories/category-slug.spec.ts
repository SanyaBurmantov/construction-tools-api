import {
  categoryPathKey,
  categorySlugCandidates,
  numberedSlug,
} from './category-slug';

describe('categorySlugCandidates', () => {
  it('prefers the bare leaf slug, so existing category URLs do not move', () => {
    expect(
      categorySlugCandidates(['elektroinstrument', 'perforatory'])[0],
    ).toBe('perforatory');
  });

  it('falls back to parent-leaf, then the whole chain', () => {
    expect(
      categorySlugCandidates(['aksessuary', 'avtolampy', 'prochee']),
    ).toEqual(['prochee', 'avtolampy-prochee', 'aksessuary-avtolampy-prochee']);
  });

  it('collapses to one candidate for a top-level category', () => {
    expect(categorySlugCandidates(['instrument'])).toEqual(['instrument']);
  });

  it('does not repeat a candidate when parent-leaf equals the full chain', () => {
    expect(categorySlugCandidates(['ruchnoy', 'molotki'])).toEqual([
      'molotki',
      'ruchnoy-molotki',
    ]);
  });

  it('ignores empty segments and handles an empty chain', () => {
    expect(categorySlugCandidates(['', 'molotki'])).toEqual(['molotki']);
    expect(categorySlugCandidates([])).toEqual([]);
  });
});

describe('categoryPathKey', () => {
  it('is the full chain, which is what makes same-named leaves distinct', () => {
    const first = categoryPathKey(['aksessuary', 'prochee']);
    const second = categoryPathKey(['elektroinstrument', 'prochee']);

    expect(first).toBe('aksessuary/prochee');
    expect(first).not.toBe(second);
  });

  it('drops empty segments so a chain never gains a blank level', () => {
    expect(categoryPathKey(['a', '', 'b'])).toBe('a/b');
  });
});

describe('numberedSlug', () => {
  it('suffixes the base for the exhausted-candidates case', () => {
    expect(numberedSlug('a-b-prochee', 2)).toBe('a-b-prochee-2');
  });
});
