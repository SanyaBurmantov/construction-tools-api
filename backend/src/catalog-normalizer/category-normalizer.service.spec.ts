import { CategoryNormalizerService } from './category-normalizer.service';
import { FALLBACK_CATEGORY_SLUG } from '../common/constants/catalog';

/**
 * The category pass hides products and deletes categories on a live catalogue,
 * on a nightly cron. These cover the invariants that make that safe to leave
 * running: whose products may be hidden, what may never be deleted, and that a
 * second night finds nothing left to do.
 *
 * The fake applies what it is told rather than only recording it — the steps
 * run in sequence and each reads what the previous one wrote, so a mock that
 * answered from a frozen fixture would report a clean second pass for a
 * normalizer that loops forever.
 */

type Category = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  /** A supplier category maps here, which makes it configuration, not debris. */
  mapped?: boolean;
  pricingRule?: boolean;
};

type Product = {
  id: string;
  categoryId: string;
  status: 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';
  /** Source codes carrying this product. */
  sources: string[];
};

class FakePrisma {
  writes = 0;

  constructor(
    public categories: Category[],
    public products: Product[],
  ) {}

  category = {
    findMany: (args: {
      where?: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => {
      const where = args.where ?? {};
      let rows = this.categories;

      if ('parentId' in where) rows = rows.filter((c) => c.parentId === null);
      if (where.slug) {
        const not = (where.slug as { not: string }).not;
        rows = rows.filter((c) => c.slug !== not);
      }
      if (where.products) rows = rows.filter((c) => !this.hasProducts(c.id));
      if (where.children) rows = rows.filter((c) => !this.hasChildren(c.id));
      if (where.mappedSourceCategories) rows = rows.filter((c) => !c.mapped);
      if (where.pricingRules) rows = rows.filter((c) => !c.pricingRule);

      return Promise.resolve(
        rows.map((c) => ({
          ...c,
          _count: {
            products: this.products.filter((p) => p.categoryId === c.id).length,
            children: this.categories.filter((x) => x.parentId === c.id).length,
          },
        })),
      );
    },

    findUnique: (args: { where: { slug: string } }) =>
      Promise.resolve(
        this.categories.find((c) => c.slug === args.where.slug) ?? null,
      ),

    create: (args: { data: { name: string; slug: string } }) => {
      this.writes += 1;
      const created: Category = {
        id: `cat-${this.categories.length + 1}`,
        name: args.data.name,
        slug: args.data.slug,
        parentId: null,
      };
      this.categories.push(created);
      return Promise.resolve(created);
    },

    deleteMany: (args: { where: { id: { in: string[] } } }) => {
      this.writes += 1;
      const before = this.categories.length;
      this.categories = this.categories.filter(
        (c) => !args.where.id.in.includes(c.id),
      );
      return Promise.resolve({ count: before - this.categories.length });
    },

    count: () => Promise.resolve(this.categories.length),
  };

  product = {
    count: (args: { where: Record<string, unknown> }) =>
      Promise.resolve(this.matching(args.where).length),

    updateMany: (args: {
      where: Record<string, unknown>;
      data: { status: Product['status'] };
    }) => {
      this.writes += 1;
      const rows = this.matching(args.where);
      for (const row of rows) row.status = args.data.status;
      return Promise.resolve({ count: rows.length });
    },

    groupBy: () =>
      Promise.resolve(
        [...new Set(this.products.map((p) => p.categoryId))].map(
          (categoryId) => ({
            categoryId,
            _count: {
              _all: this.products.filter(
                (p) => p.categoryId === categoryId && p.status === 'PUBLISHED',
              ).length,
            },
          }),
        ),
      ),
  };

  specification = {
    deleteMany: () => {
      this.writes += 1;
      return Promise.resolve({ count: 0 });
    },
  };

  categoryRedirect = {
    deleteMany: () => {
      this.writes += 1;
      return Promise.resolve({ count: 0 });
    },
  };

  private hasProducts(id: string) {
    return this.products.some((p) => p.categoryId === id);
  }

  private hasChildren(id: string) {
    return this.categories.some((c) => c.parentId === id);
  }

  /** The subset of Prisma's product filter the normalizer actually builds. */
  private matching(where: Record<string, unknown>) {
    const ids = (where.categoryId as { in: string[] } | undefined)?.in;
    const status = where.status as Product['status'] | undefined;
    const sourceFilter = where.sourceProducts as
      | {
          every?: { source: { code: string } };
          some?: { source: { code: string } };
        }
      | undefined;

    return this.products.filter((product) => {
      if (ids && !ids.includes(product.categoryId)) return false;
      if (status && product.status !== status) return false;
      if (sourceFilter?.every) {
        const code = sourceFilter.every.source.code;
        if (!product.sources.every((source) => source === code)) return false;
      }
      if (sourceFilter?.some) {
        const code = sourceFilter.some.source.code;
        if (!product.sources.includes(code)) return false;
      }
      return true;
    });
  }
}

/** Moves products and children onto the survivor, then drops the category. */
function fakeMerges(prisma: FakePrisma) {
  return {
    merge: jest.fn((fromId: string, intoId: string) => {
      prisma.writes += 1;
      for (const product of prisma.products) {
        if (product.categoryId === fromId) product.categoryId = intoId;
      }
      for (const category of prisma.categories) {
        if (category.parentId === fromId) category.parentId = intoId;
      }
      prisma.categories = prisma.categories.filter((c) => c.id !== fromId);
      return Promise.resolve({ movedProducts: 0 });
    }),
  };
}

function fakeSettings(
  filters: Record<string, { include: string; exclude: string }> = {},
) {
  return {
    getCategoryFilters: (code: string) =>
      Promise.resolve(filters[code] ?? { include: '', exclude: '' }),
  };
}

function build(
  categories: Category[],
  products: Product[],
  filters?: Record<string, { include: string; exclude: string }>,
) {
  const prisma = new FakePrisma(categories, products);
  const merges = fakeMerges(prisma);
  const service = new CategoryNormalizerService(
    prisma as never,
    merges as never,
    fakeSettings(filters) as never,
  );
  return { service, prisma, merges };
}

const EXCLUDE_COSMETICS = { include: '', exclude: 'косметика' };

describe('CategoryNormalizerService', () => {
  describe('source category filters', () => {
    it('hides a product only its own source brought in', async () => {
      const { service, prisma } = build(
        [
          {
            id: 'c1',
            name: 'Косметика, уход',
            slug: 'kosmetika',
            parentId: null,
          },
        ],
        [
          {
            id: 'p1',
            categoryId: 'c1',
            status: 'PUBLISHED',
            sources: ['th-tools'],
          },
        ],
        { 'th-tools': EXCLUDE_COSMETICS },
      );

      const report = await service.normalize();

      expect(report.filteredOut).toBe(1);
      expect(prisma.products[0].status).toBe('HIDDEN');
    });

    it('leaves a product alone when another supplier also carries it', async () => {
      const { service, prisma } = build(
        [
          {
            id: 'c1',
            name: 'Косметика, уход',
            slug: 'kosmetika',
            parentId: null,
          },
        ],
        [
          {
            id: 'p1',
            categoryId: 'c1',
            status: 'PUBLISHED',
            // dukon has no filter excluding this category, so hiding the product
            // would remove an offer nobody asked to drop.
            sources: ['th-tools', 'dukon'],
          },
        ],
        { 'th-tools': EXCLUDE_COSMETICS },
      );

      const report = await service.normalize();

      expect(report.filteredOut).toBe(0);
      expect(prisma.products[0].status).toBe('PUBLISHED');
    });

    it('never touches a status a human set', async () => {
      const { service, prisma } = build(
        [
          {
            id: 'c1',
            name: 'Косметика, уход',
            slug: 'kosmetika',
            parentId: null,
          },
        ],
        [
          {
            id: 'p1',
            categoryId: 'c1',
            status: 'ARCHIVED',
            sources: ['th-tools'],
          },
          {
            id: 'p2',
            categoryId: 'c1',
            status: 'HIDDEN',
            sources: ['th-tools'],
          },
        ],
        { 'th-tools': EXCLUDE_COSMETICS },
      );

      await service.normalize();

      expect(prisma.products.map((p) => p.status)).toEqual([
        'ARCHIVED',
        'HIDDEN',
      ]);
    });

    it('matches the filter against the whole breadcrumb chain', async () => {
      // The parsers test `names.join(' / ')`, so a child of an excluded root has
      // to be excluded too — otherwise the retroactive pass disagrees with the
      // parser that would have skipped the URL.
      const { service, prisma } = build(
        [
          {
            id: 'c1',
            name: 'Косметика, уход',
            slug: 'kosmetika',
            parentId: null,
          },
          { id: 'c2', name: 'Шампуни', slug: 'shampuni', parentId: 'c1' },
        ],
        [
          {
            id: 'p1',
            categoryId: 'c2',
            status: 'PUBLISHED',
            sources: ['th-tools'],
          },
        ],
        { 'th-tools': EXCLUDE_COSMETICS },
      );

      await service.normalize();

      expect(prisma.products[0].status).toBe('HIDDEN');
    });
  });

  describe('placeholders and roots', () => {
    it('moves products out of a placeholder root and removes it', async () => {
      const { service, prisma } = build(
        [
          { id: 'c1', name: '!!ПУСТО!!', slug: 'pusto', parentId: null },
          {
            id: 'c2',
            name: 'Неразобранные товары поставщиков',
            slug: FALLBACK_CATEGORY_SLUG,
            parentId: null,
          },
        ],
        [
          {
            id: 'p1',
            categoryId: 'c1',
            status: 'PUBLISHED',
            sources: ['dukon'],
          },
        ],
      );

      const report = await service.normalize();

      expect(report.placeholderProductsMoved).toBe(1);
      expect(report.placeholdersRemoved).toBe(1);
      expect(prisma.products[0].categoryId).toBe('c2');
      expect(prisma.categories.map((c) => c.slug)).not.toContain('pusto');
    });

    it('merges a supplier root into its canonical department', async () => {
      const { service, merges } = build(
        [
          { id: 'c1', name: 'Пневматика', slug: 'pnevmatika', parentId: null },
          {
            id: 'c2',
            name: 'Пневматический инструмент',
            slug: 'pnevmoinstrument',
            parentId: null,
          },
        ],
        [
          {
            id: 'p1',
            categoryId: 'c1',
            status: 'PUBLISHED',
            sources: ['dukon'],
          },
        ],
      );

      const report = await service.normalize();

      expect(report.rootsMerged).toBe(1);
      expect(merges.merge).toHaveBeenCalledWith('c1', 'c2');
    });

    it('leaves a root alone when its canonical department is absent', async () => {
      // Renaming the root instead would be a different decision, and one a
      // human should make — so the pass reports it as unmapped work, not done.
      const { service, merges, prisma } = build(
        [{ id: 'c1', name: 'Пневматика', slug: 'pnevmatika', parentId: null }],
        [
          {
            id: 'p1',
            categoryId: 'c1',
            status: 'PUBLISHED',
            sources: ['dukon'],
          },
        ],
      );

      const report = await service.normalize();

      expect(report.rootsMerged).toBe(0);
      expect(merges.merge).not.toHaveBeenCalled();
      expect(prisma.categories).toHaveLength(1);
    });
  });

  describe('pruning', () => {
    it('keeps a category a supplier mapping or a pricing rule points at', async () => {
      const { service, prisma } = build(
        [
          { id: 'c1', name: 'Пустая', slug: 'empty', parentId: null },
          {
            id: 'c2',
            name: 'Маппинг',
            slug: 'mapped',
            parentId: null,
            mapped: true,
          },
          {
            id: 'c3',
            name: 'Правило',
            slug: 'priced',
            parentId: null,
            pricingRule: true,
          },
        ],
        [],
      );

      const report = await service.normalize();

      expect(report.emptyCategoriesRemoved).toBe(1);
      expect(prisma.categories.map((c) => c.slug).sort()).toEqual([
        'mapped',
        'priced',
      ]);
    });

    it('keeps the fallback category even when it is empty', async () => {
      const { service, prisma } = build(
        [
          {
            id: 'c1',
            name: 'Неразобранные товары поставщиков',
            slug: FALLBACK_CATEGORY_SLUG,
            parentId: null,
          },
        ],
        [],
      );

      await service.normalize();

      expect(prisma.categories.map((c) => c.slug)).toEqual([
        FALLBACK_CATEGORY_SLUG,
      ]);
    });

    it('removes a parent orphaned by pruning its last child', async () => {
      const { service, prisma } = build(
        [
          { id: 'c1', name: 'Родитель', slug: 'parent', parentId: null },
          { id: 'c2', name: 'Ребёнок', slug: 'child', parentId: 'c1' },
        ],
        [],
      );

      const report = await service.normalize();

      expect(report.emptyCategoriesRemoved).toBe(2);
      expect(prisma.categories).toHaveLength(0);
    });
  });

  it('writes nothing in a dry run, and reports what it would have done', async () => {
    const categories: Category[] = [
      { id: 'c1', name: '!!ПУСТО!!', slug: 'pusto', parentId: null },
      { id: 'c2', name: 'Пневматика', slug: 'pnevmatika', parentId: null },
      {
        id: 'c3',
        name: 'Пневматический инструмент',
        slug: 'pnevmoinstrument',
        parentId: null,
      },
      { id: 'c4', name: 'Пустая', slug: 'empty', parentId: null },
    ];
    const products: Product[] = [
      { id: 'p1', categoryId: 'c1', status: 'PUBLISHED', sources: ['dukon'] },
      { id: 'p2', categoryId: 'c2', status: 'PUBLISHED', sources: ['dukon'] },
    ];
    const snapshot = JSON.stringify([categories, products]);

    const { service, prisma, merges } = build(categories, products);
    const report = await service.normalize(true);

    expect(report.dryRun).toBe(true);
    expect(prisma.writes).toBe(0);
    expect(merges.merge).not.toHaveBeenCalled();
    expect(JSON.stringify([prisma.categories, prisma.products])).toBe(snapshot);

    expect(report.placeholdersRemoved).toBe(1);
    expect(report.rootsMerged).toBe(1);
    // Two, not one: a dry run writes nothing, so the pruning step still sees
    // "Пневматический инструмент" empty — in a real run the root merge above
    // would have filled it first. A preview therefore over-reports deletions,
    // never under-reports them, which is the safe direction for a number an
    // operator reads before letting the job touch a live catalogue.
    expect(report.emptyCategoriesRemoved).toBe(2);
  });

  it('leaves nothing to do on a second pass', async () => {
    const { service } = build(
      [
        { id: 'c1', name: '!!ПУСТО!!', slug: 'pusto', parentId: null },
        { id: 'c2', name: 'Пневматика', slug: 'pnevmatika', parentId: null },
        {
          id: 'c3',
          name: 'Пневматический инструмент',
          slug: 'pnevmoinstrument',
          parentId: null,
        },
        {
          id: 'c4',
          name: 'Косметика, уход',
          slug: 'kosmetika',
          parentId: null,
        },
      ],
      [
        { id: 'p1', categoryId: 'c1', status: 'PUBLISHED', sources: ['dukon'] },
        { id: 'p2', categoryId: 'c2', status: 'PUBLISHED', sources: ['dukon'] },
        {
          id: 'p3',
          categoryId: 'c4',
          status: 'PUBLISHED',
          sources: ['th-tools'],
        },
      ],
      { 'th-tools': EXCLUDE_COSMETICS },
    );

    await service.normalize();
    const again = await service.normalize();

    expect(again.filteredOut).toBe(0);
    expect(again.placeholderProductsMoved).toBe(0);
    expect(again.placeholdersRemoved).toBe(0);
    expect(again.rootsMerged).toBe(0);
    expect(again.emptyCategoriesRemoved).toBe(0);
  });
});
