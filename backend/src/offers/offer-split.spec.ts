import { articleKey, planSplit, type SplitOffer } from './offer-split';

const offer = (
  id: string,
  sku: string | null,
  sourceId = 'th',
): SplitOffer => ({
  id,
  sourceId,
  sku,
  url: `https://th-tool.by/${id}/`,
  name: 'Пистолет для подкачки шин с манометром',
});

describe('planSplit', () => {
  it('gives every other article of the same supplier its own product', () => {
    const groups = planSplit([
      offer('a', 'F-STG-32'),
      offer('b', 'RF-STG-32'),
      offer('c', 'PA-STG-32'),
      offer('d', 'rf stg 32'),
    ]);
    expect(groups.map((g) => [g.article, g.offers.map((o) => o.id)])).toEqual([
      ['RFSTG32', ['b', 'd']],
      ['PASTG32', ['c']],
    ]);
  });

  it('keeps the owner’s article and offers without one on the card', () => {
    expect(
      planSplit([offer('a', 'C0044'), offer('b', 'C0044 '), offer('c', null)]),
    ).toEqual([]);
  });

  // Each supplier's sku is its own internal number.
  it('leaves a product two suppliers sell under their own codes alone', () => {
    expect(
      planSplit([offer('a', 'C0044', 'th'), offer('b', '45678', 'tools')]),
    ).toEqual([]);
  });

  it('normalises articles', () => {
    expect(articleKey('C0044[ GM ]')).toBe('C0044GM');
    expect(articleKey(null)).toBe('');
  });
});
