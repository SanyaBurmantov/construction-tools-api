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
};

function category(
  id: string,
  name: string,
  parentId: string | null,
  path: string[],
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

  it('throws 404 for an unknown slug', async () => {
    await expect(buildService().getBySlug('nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});
