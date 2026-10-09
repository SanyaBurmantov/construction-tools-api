import { CategoryTreeService } from './category-tree.service';

describe('CategoryTreeService navigation roots', () => {
  it('does not recreate navigation categories, regardless of case and whitespace', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest.fn(({ data }: { data: { slug: string } }) =>
      Promise.resolve({ id: data.slug, slug: data.slug }),
    );
    const service = new CategoryTreeService({
      category: { findUnique, create },
      categoryRedirect: { findUnique: jest.fn().mockResolvedValue(null) },
    } as never);
    await expect(
      service.upsertBranch([' ГЛАВНАЯ ', 'Каталог']),
    ).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
    await service.upsertBranch(['Главная', 'Каталог', 'Дрели']);
    expect(create.mock.calls[0][0].data).toMatchObject({
      name: 'Дрели',
      parentId: null,
      pathKey: 'dreli',
      path: ['dreli'],
      level: 0,
    });
  });

  it('does not reuse an old redirected slug for a different category', async () => {
    const create = jest.fn(({ data }: { data: { slug: string } }) =>
      Promise.resolve({ id: data.slug, slug: data.slug }),
    );
    const service = new CategoryTreeService({
      category: { findUnique: jest.fn().mockResolvedValue(null), create },
      categoryRedirect: {
        findUnique: jest.fn(({ where }: { where: { slug: string } }) =>
          Promise.resolve(where.slug === 'dreli' ? { slug: 'dreli' } : null),
        ),
      },
    } as never);
    await expect(service.upsertBranch(['Дрели'])).resolves.toMatchObject({
      slug: 'dreli-2',
      pathKey: 'dreli',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
