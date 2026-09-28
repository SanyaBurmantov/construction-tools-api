import { latToRu, ruToLat, searchVariants } from './transliterate';

describe('transliterate', () => {
  it('converts Russian to Latin', () => {
    expect(ruToLat('макита')).toBe('makita');
    expect(ruToLat('Перфоратор')).toBe('perforator');
  });

  it('converts Latin to Russian with digraphs first', () => {
    expect(latToRu('makita')).toBe('макита');
    expect(latToRu('shurup')).toBe('шуруп');
  });

  it('builds variants: the term plus transliterations', () => {
    expect(searchVariants('макита')).toEqual(['макита', 'makita']);
    expect(searchVariants('makita')).toEqual(['makita', 'макита']);
    expect(searchVariants('  ')).toEqual([]);
    // digits-only terms stay as-is
    expect(searchVariants('1006')).toEqual(['1006']);
  });
});
