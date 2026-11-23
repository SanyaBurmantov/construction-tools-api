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
  /** Who set the status; SYSTEM when left out. */
  statusSource?: 'SYSTEM' | 'ADMIN';
  /** Source codes carrying this product. */
  sources: string[];
  /** The supplier category of its offers (`SourceProduct.sourceCategoryId`). */
  sourceCategoryId?: string;
  /** Product price; its offers carry a live price when this is set. */
  priceValue?: number;
};

/** A supplier's own category, as the parser saved its breadcrumb chain. */
type SourceCategory = {
  id: string;
  source: string;
  name: string;
  parentId: string | null;
};

class FakePrisma {
  writes = 0;

  constructor(
    public categories: Category[],
    public products: Product[],
    public sourceCategories: SourceCategory[] = [],
  ) {}

  sourceCategory = {
    findMany: (args: { where: { source: { code: string } } }) =>
      Promise.resolve(
        this.sourceCategories
          .filter((c) => c.source === args.where.source.code)
          .map(({ id, name, parentId }) => ({ id, name, parentId })),
      ),
  };

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

    delete: (args: { where: { id: string } }) => {
      this.writes += 1;
      this.categories = this.categories.filter((c) => c.id !== args.where.id);
      return Promise.resolve({});
    },
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

  productSpecification = {
    deleteMany: () => Promise.resolve({ count: 0 }),
  };

  /** The prune query: empty, uncurated, unreferenced categories. */
  $queryRaw = () =>
    Promise.resolve(
      this.categories
        .filter(
          (c) =>
            c.slug !== FALLBACK_CATEGORY_SLUG &&
            !this.hasProducts(c.id) &&
            !this.hasChildren(c.id) &&
            !c.mapped &&
            !c.pricingRule,
        )
        .map((c) => ({ id: c.id })),
    );

  // Array transactions: the operations already ran when they were built.
  $transaction = (ops: Promise<unknown>[]) => Promise.all(ops);

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
    type OfferWhere = {
      source: { code: string };
      sourceCategoryId?: { in?: string[]; notIn?: string[]; not?: null };
      price?: { gt: number };
    };
    const ids = (where.categoryId as { in: string[] } | undefined)?.in;
    const status = where.status as Product['status'] | undefined;
    const statusSource = where.statusSource as string | undefined;
    const priced = where.priceValue as { gt: number } | undefined;
    const offers = where.sourceProducts as
      | { every?: OfferWhere; some?: OfferWhere }
      | undefined;

    // Every offer of a fake product shares its sourceCategoryId and price.
    const offerMatches = (product: Product, source: string, w: OfferWhere) => {
      if (source !== w.source.code) return false;
      const category = w.sourceCategoryId;
      const id = product.sourceCategoryId;
      if (category?.in && !(id && category.in.includes(id))) return false;
      if (category?.not === null && !id) return false;
      if (category?.notIn && id && category.notIn.includes(id)) return false;
      if (w.price && !((product.priceValue ?? 0) > w.price.gt)) return false;
      return true;
    };

    return this.products.filter((product) => {
      if (ids && !ids.includes(product.categoryId)) return false;
      if (status && product.status !== status) return false;
      if (statusSource && (product.statusSource ?? 'SYSTEM') !== statusSource)
        return false;
      if (priced && !((product.priceValue ?? 0) > priced.gt)) return false;
      const { every, some } = offers ?? {};
      if (
        every &&
        !product.sources.every((s) => offerMatches(product, s, every))
      )
        return false;
      if (some && !product.sources.some((s) => offerMatches(product, s, some)))
        return false;
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
  sourceCategories: SourceCategory[] = [],
) {
  const prisma = new FakePrisma(categories, products, sourceCategories);
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
    const OUR_ROOT: Category = {
      id: 'c1',
      name: 'Инструмент',
      slug: 'instrument',
      parentId: null,
    };
    const TH_COSMETICS: SourceCategory = {
      id: 'sc1',
      source: 'th-tools',
      name: 'Косметика, уход',
      parentId: null,
    };

    it('hides a product only its own source brought in', async () => {
      const { service, prisma } = build(
        [OUR_ROOT],
        [
          {
            id: 'p1',
            categoryId: 'c1',
            status: 'PUBLISHED',
            sources: ['th-tools'],
            sourceCategoryId: 'sc1',
          },
        ],
        { 'th-tools': EXCLUDE_COSMETICS },
        [TH_COSMETICS],
      );

      const report = await service.normalize();

      expect(report.filteredOut).toBe(1);
      expect(prisma.products[0].status).toBe('HIDDEN');
    });

    it('leaves a product alone when another supplier also carries it', async () => {
      const { service, prisma } = build(
        [OUR_ROOT],
        [
          {
            id: 'p1',
            categoryId: 'c1',
            status: 'PUBLISHED',
            // dukon has no filter excluding this category, so hiding the product
            // would remove an offer nobody asked to drop.
            sources: ['th-tools', 'dukon'],
            sourceCategoryId: 'sc1',
          },
        ],
        { 'th-tools': EXCLUDE_COSMETICS },
        [TH_COSMETICS],
      );

      const report = await service.normalize();

      expect(report.filteredOut).toBe(0);
      expect(prisma.products[0].status).toBe('PUBLISHED');
    });

    it('never touches a status a human set', async () => {
      const { service, prisma } = build(
        [OUR_ROOT],
        [
          {
            id: 'p1',
            categoryId: 'c1',
            status: 'ARCHIVED',
            statusSource: 'ADMIN',
            sources: ['th-tools'],
            sourceCategoryId: 'sc1',
          },
          {
            id: 'p2',
            categoryId: 'c1',
            status: 'HIDDEN',
            statusSource: 'ADMIN',
            sources: ['th-tools'],
            sourceCategoryId: 'sc2',
            priceValue: 10,
          },
        ],
        { 'th-tools': EXCLUDE_COSMETICS },
        [
          TH_COSMETICS,
          { id: 'sc2', source: 'th-tools', name: 'Дрели', parentId: null },
        ],
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
        [OUR_ROOT],
        [
          {
            id: 'p1',
            categoryId: 'c1',
            status: 'PUBLISHED',
            sources: ['th-tools'],
            sourceCategoryId: 'sc2',
          },
        ],
        { 'th-tools': EXCLUDE_COSMETICS },
        [
          TH_COSMETICS,
          { id: 'sc2', source: 'th-tools', name: 'Шампуни', parentId: 'sc1' },
        ],
      );

      await service.normalize();

      expect(prisma.products[0].status).toBe('HIDDEN');
    });

    it("reads the supplier's chain, not our tree (b2bit, 2026-11-20)", async () => {
      // Our b2bit branch starts below «Стройка и ремонт», so an include of
      // that department matched none of OUR categories and every b2bit
      // product was hidden each night.
      const { service, prisma } = build(
        [
          {
            id: 'c1',
            name: 'Электроинструмент',
            slug: 'elektroinstrument',
            parentId: null,
          },
          { id: 'c2', name: 'Дрели', slug: 'dreli', parentId: 'c1' },
        ],
        [
          {
            id: 'p1',
            categoryId: 'c2',
            status: 'PUBLISHED',
            sources: ['b2bit'],
            sourceCategoryId: 'b3',
            priceValue: 120,
          },
          {
            id: 'p2',
            categoryId: 'c2',
            status: 'PUBLISHED',
            sources: ['b2bit'],
            sourceCategoryId: 'b4',
            priceValue: 900,
          },
        ],
        { b2bit: { include: '^Стройка и ремонт( /|$)', exclude: '' } },
        [
          {
            id: 'b1',
            source: 'b2bit',
            name: 'Стройка и ремонт',
            parentId: null,
          },
          {
            id: 'b2',
            source: 'b2bit',
            name: 'Электроинструмент',
            parentId: 'b1',
          },
          { id: 'b3', source: 'b2bit', name: 'Дрели', parentId: 'b2' },
          { id: 'b4', source: 'b2bit', name: 'Ноутбуки', parentId: null },
        ],
      );

      const report = await service.normalize();

      expect(report.filteredOut).toBe(1);
      expect(prisma.products.map((p) => p.status)).toEqual([
        'PUBLISHED',
        'HIDDEN',
      ]);
    });

    it('puts back on sale what it hid once the filter allows it', async () => {
      const b2bitTree: SourceCategory[] = [
        { id: 'b1', source: 'b2bit', name: 'Стройка и ремонт', parentId: null },
        { id: 'b2', source: 'b2bit', name: 'Дрели', parentId: 'b1' },
      ];
      const { service, prisma } = build(
        [OUR_ROOT],
        [
          // Hidden by the broken pass: allowed category, live price.
          {
            id: 'p1',
            categoryId: 'c1',
            status: 'HIDDEN',
            sources: ['b2bit'],
            sourceCategoryId: 'b2',
            priceValue: 120,
          },
          // Every offer withdrawn (no price): stays hidden.
          {
            id: 'p2',
            categoryId: 'c1',
            status: 'HIDDEN',
            sources: ['b2bit'],
            sourceCategoryId: 'b2',
          },
          // An admin hid it: stays hidden.
          {
            id: 'p3',
            categoryId: 'c1',
            status: 'HIDDEN',
            statusSource: 'ADMIN',
            sources: ['b2bit'],
            sourceCategoryId: 'b2',
            priceValue: 50,
          },
        ],
        { b2bit: { include: '^Стройка и ремонт( /|$)', exclude: '' } },
        b2bitTree,
      );

      const preview = await service.normalize(true);
      expect(preview.filteredBack).toBe(1);
      expect(prisma.products[0].status).toBe('HIDDEN');

      const report = await service.normalize();

      expect(report.filteredBack).toBe(1);
      expect(prisma.products.map((p) => p.status)).toEqual([
        'PUBLISHED',
        'HIDDEN',
        'HIDDEN',
      ]);
      expect((await service.normalize()).filteredBack).toBe(0);
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
          sourceCategoryId: 'sc4',
        },
      ],
      { 'th-tools': EXCLUDE_COSMETICS },
      [
        {
          id: 'sc4',
          source: 'th-tools',
          name: 'Косметика, уход',
          parentId: null,
        },
      ],
    );

    await service.normalize();
    const again = await service.normalize();

    expect(again.filteredOut).toBe(0);
    expect(again.filteredBack).toBe(0);
    expect(again.placeholderProductsMoved).toBe(0);
    expect(again.placeholdersRemoved).toBe(0);
    expect(again.rootsMerged).toBe(0);
    expect(again.emptyCategoriesRemoved).toBe(0);
  });
});
