import { CategoryDuplicatesCron } from './category-duplicates.cron';
import type { CategoryMergeService } from './category-merge.service';

const cat = (id: string, isVisible = true) => ({
  id,
  name: 'Компрессоры',
  slug: id,
  isVisible,
  productCount: 0,
  childCount: 0,
});

describe('CategoryDuplicatesCron', () => {
  function build(groups: unknown[]) {
    const mergeDuplicates = jest.fn(() => Promise.resolve({ ok: true }));
    const service = {
      findDuplicates: jest.fn(() => Promise.resolve({ groups })),
      mergeDuplicates,
    } as unknown as CategoryMergeService;
    return { cron: new CategoryDuplicatesCron(service), mergeDuplicates };
  }

  it('folds every copy into the suggested target', async () => {
    const { cron, mergeDuplicates } = build([
      {
        name: 'Компрессоры',
        targetId: 'a',
        categories: [cat('a'), cat('b'), cat('c')],
      },
    ]);
    await expect(cron.run()).resolves.toMatchObject({ folded: 2, skipped: 0 });
    expect(mergeDuplicates).toHaveBeenCalledWith('a', ['b', 'c']);
  });

  it('leaves a group with a copy an admin hid', async () => {
    const { cron, mergeDuplicates } = build([
      {
        name: 'Компрессоры',
        targetId: 'a',
        categories: [cat('a'), cat('b', false)],
      },
    ]);
    await expect(cron.run()).resolves.toMatchObject({ folded: 0, skipped: 1 });
    expect(mergeDuplicates).not.toHaveBeenCalled();
  });

  it('keeps going when one group fails', async () => {
    const { cron, mergeDuplicates } = build([
      { name: 'X', targetId: 'a', categories: [cat('a'), cat('b')] },
      { name: 'Y', targetId: 'c', categories: [cat('c'), cat('d')] },
    ]);
    mergeDuplicates.mockRejectedValueOnce(new Error('gone'));
    await expect(cron.run()).resolves.toMatchObject({ folded: 1 });
  });
});
