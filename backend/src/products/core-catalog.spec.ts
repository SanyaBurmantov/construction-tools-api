import { nonCoreCategoryIds, rootsOf } from './core-catalog';

const rows = [
  { id: 'tools', parentId: null, name: 'Ручной инструмент' },
  { id: 'keys', parentId: 'tools', name: 'Ключи' },
  { id: 'home', parentId: null, name: 'Товары для дома' },
  { id: 'pots', parentId: 'home', name: 'Посуда' },
  { id: 'enamel', parentId: 'pots', name: 'Эмалированная' },
];

describe('core catalogue', () => {
  it('finds each category’s root', () => {
    expect(rootsOf(rows).get('enamel')!.id).toBe('home');
    expect(rootsOf(rows).get('keys')!.id).toBe('tools');
  });

  it('leaves out whole non-core departments, nothing else', () => {
    expect(nonCoreCategoryIds(rows).sort()).toEqual(['enamel', 'home', 'pots']);
  });

  it('survives a parent cycle', () => {
    const cyclic = [
      { id: 'a', parentId: 'b', name: 'A' },
      { id: 'b', parentId: 'a', name: 'B' },
    ];
    expect(() => rootsOf(cyclic)).not.toThrow();
  });
});
