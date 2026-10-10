import { NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../prisma/prisma.service';

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  level: number;
  image: string | null;
  path: string[];
  description: string | null;
  seoTitle: string;
  seoDescription: string;
  sortOrder: number;
  isVisible: boolean;
  isFeatured: boolean;
};

function category(
  id: string,
  name: string,
  parentId: string | null,
  path: string[],
  display: Partial<
    Pick<CategoryRow, 'sortOrder' | 'isVisible' | 'isFeatured'>
  > = {},
): CategoryRow {
  return {
    id,
    name,
    slug: path[path.length - 1],
    parentId,
    level: path.length - 1,
    image: null,
    path,
    description: null,
    seoTitle: name,
    seoDescription: name,
    sortOrder: 0,
    isVisible: true,
    isFeatured: false,
    ...display,
  };
}

const rows: CategoryRow[] = [
  category('c1', 'Электроинструмент', null, ['elektro']),
  category('c2', 'Дрели', 'c1', ['elektro', 'dreli']),
  category('c3', 'Перфораторы', 'c1', ['elektro', 'perforatory']),
  category('c4', 'Пустая ветка', null, ['empty']),
];

// counts per leaf category: products live on leaves only
const counts = [
  { categoryId: 'c2', _count: { _all: 5 } },
  { categoryId: 'c3', _count: { _all: 3 } },
];

function buildServiceWith(rowsOverride: CategoryRow[]) {
  const prisma = {
    category: {
      findMany: jest.fn(() => Promise.resolve(rowsOverride)),
      findUnique: jest.fn((args: { where: { slug: string } }) =>
        Promise.resolve(
          rowsOverride.find((row) => row.slug === args.where.slug) ?? null,
        ),
      ),
    },
    categoryRedirect: { findUnique: jest.fn(() => Promise.resolve(null)) },
    product: { groupBy: jest.fn(() => Promise.resolve(counts)) },
  } as unknown as PrismaService;
  return new CategoriesService(prisma);
}

function buildService() {
  const prisma = {
    category: {
      findMany: jest.fn((args?: { where?: { slug?: { in: string[] } } }) => {
        if (args?.where?.slug?.in) {
          // the service selects only id/name/slug for ancestors
          return Promise.resolve(
            rows
              .filter((row) => args.where!.slug!.in.includes(row.slug))
              .map(({ id, name, slug }) => ({ id, name, slug })),
          );
        }
        return Promise.resolve(rows);
      }),
      findUnique: jest.fn((args: { where: { slug: string } }) =>
        Promise.resolve(
          rows.find((row) => row.slug === args.where.slug) ?? null,
        ),
      ),
    },
    categoryRedirect: { findUnique: jest.fn(() => Promise.resolve(null)) },
    product: {
      groupBy: jest.fn(() => Promise.resolve(counts)),
    },
  } as unknown as PrismaService;
  return new CategoriesService(prisma);
}

describe('CategoriesService.getTree', () => {
  it('aggregates descendant counts onto parents and prunes empty branches', async () => {
    const tree = await buildService().getTree();

    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root.slug).toBe('elektro');
    expect(root.productCount).toBe(8);
    expect(root.children.map((child) => child.slug)).toEqual([
      'dreli',
      'perforatory',
    ]);
    expect(root.children[0].productCount).toBe(5);
  });
});

describe('CategoriesService.getTree display settings', () => {
  // A branch an admin switched off must disappear from navigation whole:
  // listing its children would leave links into a category the shop has
  // decided not to sell from.
  it('prunes a hidden branch and its children', async () => {
    const hidden = rows.map((row) =>
      row.id === 'c1' ? { ...row, isVisible: false } : row,
    );
    expect(await buildServiceWith(hidden).getTree()).toEqual([]);
  });

  it('prunes a hidden child but keeps its parent and the parent count', async () => {
    const hidden = rows.map((row) =>
      row.id === 'c2' ? { ...row, isVisible: false } : row,
    );
    const tree = await buildServiceWith(hidden).getTree();

    expect(tree[0].children.map((child) => child.slug)).toEqual([
      'perforatory',
    ]);
    // The products are still in the catalogue and still reachable through the
    // parent, so the parent total keeps counting them.
    expect(tree[0].productCount).toBe(8);
  });

  // Default ordering is biggest-first; `sortOrder` is how an admin overrides
  // that without having to game the product counts. 0 means "not placed", so
  // a single pinned category leads and the rest keep their own order.
  it('puts a curated sortOrder ahead of the product count', async () => {
    const pinned = rows.map((row) =>
      row.id === 'c3' ? { ...row, sortOrder: 1 } : row,
    );
    const tree = await buildServiceWith(pinned).getTree();

    expect(tree[0].children.map((child) => child.slug)).toEqual([
      'perforatory',
      'dreli',
    ]);
  });
});

describe('CategoriesService.getBySlug', () => {
  it('returns ancestors in path order and children with counts', async () => {
    const page = await buildService().getBySlug('dreli');

    expect(page.productCount).toBe(5);
    expect(page.ancestors).toEqual([
      { id: 'c1', name: 'Электроинструмент', slug: 'elektro' },
    ]);
    expect(page.children).toEqual([]);
  });

  it('lists non-empty children for a parent category', async () => {
    const page = await buildService().getBySlug('elektro');

    expect(page.productCount).toBe(8);
    expect(page.ancestors).toEqual([]);
    expect(page.children.map((child) => child.slug)).toEqual([
      'dreli',
      'perforatory',
    ]);
  });

  it('leaves a hidden child out of the children list', async () => {
    const hidden = rows.map((row) =>
      row.id === 'c3' ? { ...row, isVisible: false } : row,
    );
    const page = await buildServiceWith(hidden).getBySlug('elektro');

    expect(page.children.map((child) => child.slug)).toEqual(['dreli']);
  });

  it('throws 404 for an unknown slug', async () => {
    await expect(buildService().getBySlug('nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('CategoriesService category redirects', () => {
  it('resolves an old address to the surviving category with its canonical slug', async () => {
    const findRedirect = jest.fn().mockResolvedValue({ category: rows[1] });
    const prisma = {
      category: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue(rows),
      },
      categoryRedirect: {
        findUnique: findRedirect,
      },
      product: { groupBy: jest.fn().mockResolvedValue(counts) },
    } as unknown as PrismaService;
    const result = await new CategoriesService(prisma).getBySlug(
      'legacy-dreli',
    );
    expect(result).toMatchObject({ id: 'c2', slug: 'dreli', productCount: 5 });
    expect(findRedirect).toHaveBeenCalledWith({
      where: { slug: 'legacy-dreli' },
      include: { category: true },
    });
  });
  it('uses actual parents for breadcrumbs when public slugs differ from identity components', async () => {
    const renamed = rows.map((r) =>
      r.id === 'c1' ? { ...r, slug: 'tools-elektro' } : r,
    );
    const prisma = {
      category: {
        findUnique: jest.fn().mockResolvedValue(renamed[1]),
        findMany: jest.fn().mockResolvedValue(renamed),
      },
      product: { groupBy: jest.fn().mockResolvedValue(counts) },
    } as unknown as PrismaService;
    const result = await new CategoriesService(prisma).getBySlug('dreli');
    expect(result.ancestors).toEqual([
      { id: 'c1', name: 'Электроинструмент', slug: 'tools-elektro' },
    ]);
  });
});
