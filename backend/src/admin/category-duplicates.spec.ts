import {
  findDuplicateSiblingGroups,
  sameCategoryName,
} from './category-duplicates';

const row = (id: string, name: string, parentId: string | null, slug = id) => ({
  id,
  name,
  slug,
  parentId,
  isVisible: true,
});

describe('findDuplicateSiblingGroups', () => {
  const rows = [
    row('tools', 'Наборы инструментов', null),
    row('engine', 'Двигатель', 'tools', 'specialnyi-instrument-dvigatel'),
    row('engine-4', 'Двигатель', 'tools', 'specialnyi-instrument-dvigatel-4'),
    row('engine-2', 'двигатель ', 'tools', 'specialnyi-instrument-dvigatel-2'),
    row('plugs', 'Свечи', 'engine-4'),
    row('chassis', 'Ходовая часть', 'tools'),
    // Same name under a *different* parent is not a duplicate.
    row('pneumo', 'Пневматика', null),
    row('pneumo-engine', 'Двигатель', 'pneumo'),
  ];
  const counts = new Map([
    ['engine', 10],
    ['engine-4', 5],
    ['plugs', 20],
    ['engine-2', 1],
    ['chassis', 3],
  ]);

  it('groups same-named siblings only', () => {
    const groups = findDuplicateSiblingGroups(rows, counts);
    expect(groups).toHaveLength(1);
    expect(groups[0].parent).toEqual({
      id: 'tools',
      name: 'Наборы инструментов',
      slug: 'tools',
    });
    expect(groups[0].categories.map((c) => c.id)).toEqual([
      'engine-4',
      'engine',
      'engine-2',
    ]);
  });

  it('suggests the biggest subtree as the survivor and counts children', () => {
    const [group] = findDuplicateSiblingGroups(rows, counts);
    // engine-4 holds 5 own + 20 in «Свечи».
    expect(group.targetId).toBe('engine-4');
    expect(group.categories[0]).toMatchObject({
      productCount: 25,
      childCount: 1,
    });
  });

  it('breaks a tie on the shortest slug', () => {
    const [group] = findDuplicateSiblingGroups(
      [row('a', 'X', null, 'x-2'), row('b', 'X', null, 'x')],
      new Map(),
    );
    expect(group.targetId).toBe('b');
    expect(group.parent).toBeNull();
  });

  it('returns nothing for a clean tree', () => {
    expect(
      findDuplicateSiblingGroups(
        [row('a', 'A', null), row('b', 'B', null)],
        new Map(),
      ),
    ).toEqual([]);
  });
});

describe('sameCategoryName', () => {
  it('ignores case, ё and spacing; never matches blanks', () => {
    expect(sameCategoryName('Ёмкости', 'емкости')).toBe(true);
    expect(sameCategoryName('Горелки,резаки', 'горелки, резаки')).toBe(true);
    expect(sameCategoryName('Оснастка', 'Инструмент')).toBe(false);
    expect(sameCategoryName('', '')).toBe(false);
  });
});
