import { CategoryTreeService } from './category-tree.service';

describe('CategoryTreeService navigation roots', () => {
  it('does not recreate navigation categories, regardless of case and whitespace', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest.fn(({ data }: { data: { slug: string } }) =>
      Promise.resolve({ id: data.slug, slug: data.slug }),
    );
    const service = new CategoryTreeService({
      category: {
        findUnique,
        create,
        findMany: jest.fn().mockResolvedValue([]),
      },
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
      category: {
        findUnique: jest.fn().mockResolvedValue(null),
        create,
        findMany: jest.fn().mockResolvedValue([]),
      },
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

describe('CategoryTreeService same-named siblings', () => {
  type Row = {
    id: string;
    name: string;
    slug: string;
    pathKey: string;
    parentId: string | null;
  };

  function serviceWith(rows: Row[]) {
    const create = jest.fn(
      ({ data }: { data: Omit<Row, 'id'> & { level: number } }) => {
        const row = { ...data, id: `new-${data.slug}` };
        rows.push(row);
        return Promise.resolve({ id: row.id, slug: row.slug });
      },
    );
    const prisma = {
      category: {
        findUnique: jest.fn(({ where }: { where: { pathKey: string } }) =>
          Promise.resolve(
            rows.find((row) => row.pathKey === where.pathKey) ?? null,
          ),
        ),
        findMany: jest.fn(({ where }: { where: { parentId: string | null } }) =>
          Promise.resolve(
            rows.filter((row) => row.parentId === where.parentId),
          ),
        ),
        create,
        update: jest.fn(),
      },
      categoryRedirect: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    return { service: new CategoryTreeService(prisma as never), create };
  }

  it('reuses a moved branch instead of minting «Двигатель-2»', async () => {
    // What the nightly root merge leaves behind: the supplier root is gone and
    // its child now hangs off the canonical root under a re-keyed pathKey.
    const { service, create } = serviceWith([
      {
        id: 'canon',
        name: 'Наборы инструментов и специнструмент',
        slug: 'nabory-instrumentov-i-specinstrument',
        pathKey: 'nabory-instrumentov-i-specinstrument',
        parentId: null,
      },
      {
        id: 'engine',
        name: 'Двигатель',
        slug: 'specialnyi-instrument-dvigatel',
        pathKey:
          'nabory-instrumentov-i-specinstrument/specialnyi-instrument-dvigatel',
        parentId: 'canon',
      },
    ]);

    const leaf = await service.upsertBranch([
      'Специальный инструмент',
      'Двигатель',
    ]);

    expect(create).not.toHaveBeenCalled();
    expect(leaf).toMatchObject({
      id: 'engine',
      slug: 'specialnyi-instrument-dvigatel',
    });
  });

  it('matches names regardless of case, ё and spacing', async () => {
    const { service, create } = serviceWith([
      {
        id: 'root',
        name: 'Пневматический инструмент',
        slug: 'pnevmaticheskii-instrument',
        pathKey: 'pnevmaticheskii-instrument',
        parentId: null,
      },
      {
        id: 'hoses',
        name: 'Шланги  и  ёмкости',
        slug: 'pnevmatika-shlangi',
        pathKey: 'something/else',
        parentId: 'root',
      },
    ]);

    const leaf = await service.upsertBranch([
      'Пневматический инструмент',
      'шланги и емкости',
    ]);

    expect(create).not.toHaveBeenCalled();
    expect(leaf?.id).toBe('hoses');
  });

  it('prefers the shortest slug when duplicates already exist', async () => {
    const { service } = serviceWith([
      {
        id: 'root',
        name: 'Пневматика',
        slug: 'pnevmaticheskii-instrument',
        pathKey: 'x',
        parentId: null,
      },
      {
        id: 'dup',
        name: 'Оснастка',
        slug: 'pnevmatika-osnastka-4',
        pathKey: 'x/a',
        parentId: 'root',
      },
      {
        id: 'orig',
        name: 'Оснастка',
        slug: 'pnevmatika-osnastka',
        pathKey: 'x/b',
        parentId: 'root',
      },
    ]);

    const leaf = await service.upsertBranch(['Пневматика', 'Оснастка']);
    expect(leaf?.id).toBe('orig');
  });

  it('still creates a genuinely new child', async () => {
    const { service, create } = serviceWith([
      {
        id: 'root',
        name: 'Крепеж',
        slug: 'krepezh',
        pathKey: 'krepezh',
        parentId: null,
      },
    ]);

    const leaf = await service.upsertBranch(['Крепеж', 'Анкеры']);

    expect(create).toHaveBeenCalledTimes(1);
    expect(leaf).toMatchObject({ slug: 'ankery', pathKey: 'krepezh/ankery' });
  });
});
