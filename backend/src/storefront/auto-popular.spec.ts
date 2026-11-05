import { composePopularRow } from './auto-popular';

describe('composePopularRow', () => {
  const fill = new Map([
    ['tools', ['t1', 't2', 't3']],
    ['fasteners', ['f1', 'f2']],
    ['pneumo', ['p1']],
  ]);
  const order = ['tools', 'fasteners', 'pneumo'];

  it('fills one per department before a second, biggest first', () => {
    expect(composePopularRow([], fill, order, 5)).toEqual([
      't1',
      'f1',
      'p1',
      't2',
      'f2',
    ]);
  });

  it('puts what people wanted first, best score first', () => {
    const row = composePopularRow(
      [
        { productId: 'x', rootId: 'pneumo', score: 3 },
        { productId: 'y', rootId: 'tools', score: 8 },
      ],
      fill,
      order,
      4,
    );
    expect(row.slice(0, 2)).toEqual(['y', 'x']);
    expect(row).toHaveLength(4);
  });

  it('never lets one department take more than its share', () => {
    const signals = ['a', 'b', 'c', 'd'].map((id, i) => ({
      productId: id,
      rootId: 'tools',
      score: 10 - i,
    }));
    const row = composePopularRow(signals, fill, order, 6);
    expect(
      row.filter((id) => ['a', 'b', 'c', 'd', 't1', 't2', 't3'].includes(id)),
    ).toEqual(['a', 'b']);
  });

  it('does not repeat a product that is both popular and a fill pick', () => {
    const row = composePopularRow(
      [{ productId: 't1', rootId: 'tools', score: 2 }],
      fill,
      order,
      10,
    );
    expect(row.filter((id) => id === 't1')).toHaveLength(1);
  });
});
