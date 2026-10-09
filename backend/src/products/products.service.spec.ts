import { ProductService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';

const categories = [
  { id: 'c1', parentId: null, slug: 'elektro' },
  { id: 'c2', parentId: 'c1', slug: 'dreli' },
  { id: 'c3', parentId: 'c2', slug: 'akkum-dreli' },
  { id: 'c4', parentId: null, slug: 'krepezh' },
];

function buildService() {
  // Typed with its argument list: the tests read back the Prisma args this was
  // called with, and an untyped `jest.fn(() => …)` records calls as an empty
  // tuple, so `calls[0][0]` does not type-check.
  const productFindMany = jest.fn<Promise<unknown[]>, [unknown]>(() =>
    Promise.resolve([]),
  );
  const productCount = jest.fn(() => Promise.resolve(0));
  const productGroupBy = jest.fn(() => Promise.resolve([]));
  const productAggregate = jest.fn(() =>
    Promise.resolve({
      _min: { priceValue: 10.4 },
      _max: { priceValue: 99.6 },
    }),
  );
  const queryRaw = jest.fn(() => Promise.resolve([]));
  const prisma = {
    category: {
      findMany: jest.fn(() => Promise.resolve(categories)),
    },
    product: {
      findMany: productFindMany,
      count: productCount,
      groupBy: productGroupBy,
      aggregate: productAggregate,
      // Field references (used by the onSale column-to-column comparison).
      fields: { priceValue: { name: 'priceValue' } },
    },
    sourceProduct: {
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    specification: {
      findMany: jest.fn(() => Promise.resolve([])),
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    productSpecification: {
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  return {
    service: new ProductService(prisma),
    prisma,
    productFindMany,
    productGroupBy,
    productAggregate,
    queryRaw,
  };
}

describe('ProductService.findAllFiltered', () => {
  it('expands a category filter to the whole subtree (by slug)', async () => {
    const { service, productFindMany } = buildService();
    await service.findAllFiltered({ categorySlug: 'elektro' });

    const args = productFindMany.mock.calls[0][0] as never as {
      where: { categoryId: { in: string[] } };
    };
    expect(args.where.categoryId.in.sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('matches nothing for an unknown category slug', async () => {
    const { service, productFindMany } = buildService();
    await service.findAllFiltered({ categorySlug: 'ghost' });

    const args = productFindMany.mock.calls[0][0] as never as {
      where: { categoryId: { in: string[] } };
    };
    expect(args.where.categoryId.in).toEqual([]);
  });

  it('supports comma-separated brand ids and excludes the brand dimension from its own facet', async () => {
    const { service, productFindMany, productGroupBy } = buildService();
    await service.findAllFiltered({ brandId: 'b1,b2' });

    const listArgs = productFindMany.mock.calls[0][0] as never as {
      where: { brandId: { in: string[] } };
    };
    expect(listArgs.where.brandId.in).toEqual(['b1', 'b2']);

    const brandFacetCall = (
      productGroupBy.mock.calls as unknown as Array<
        [{ by: string[]; where: { brandId?: unknown } }]
      >
    ).find(([args]) => args.by.includes('brandId'));
    expect(brandFacetCall).toBeDefined();
    expect(brandFacetCall![0].where.brandId).toEqual({ not: null });
  });

  it('returns a rounded price range facet', async () => {
    const { service } = buildService();
    const result = await service.findAllFiltered({});
    expect(result.facets.priceRange).toEqual({ min: 10, max: 100 });
  });

  it('resolves search to ranked ids and filters by them, preserving rank order', async () => {
    const { service, productFindMany, queryRaw } = buildService();
    queryRaw.mockResolvedValue([{ id: 'p2' }, { id: 'p1' }] as never);
    productFindMany
      // findPageByRelevance: matching ids in arbitrary DB order
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }] as never)
      // page rows fetched by id
      .mockResolvedValueOnce([
        { id: 'p1', productSpecs: [], _count: { sourceProducts: 2 } },
        { id: 'p2', productSpecs: [], _count: { sourceProducts: 0 } },
      ] as never);

    const result = await service.findAllFiltered({ search: ' DF333D ' });

    const args = productFindMany.mock.calls[0][0] as never as {
      where: { id: { in: string[] } };
    };
    expect(args.where.id.in).toEqual(['p2', 'p1']);
    // page follows the ranked order, not DB order
    expect(result.data.map((row) => row.id)).toEqual(['p2', 'p1']);
  });

  it('uses explicit sort instead of relevance when sortBy is set', async () => {
    const { service, productFindMany, queryRaw } = buildService();
    queryRaw.mockResolvedValue([{ id: 'p1' }] as never);

    await service.findAllFiltered({ search: 'дрель', sortBy: 'price' });

    const args = productFindMany.mock.calls[0][0] as never as {
      orderBy: Record<string, string>;
      where: { id: { in: string[] } };
    };
    expect(args.orderBy).toEqual({
      priceValue: { sort: 'asc', nulls: 'last' },
    });
    expect(args.where.id.in).toEqual(['p1']);
  });

  // Prisma rejects `nulls` on non-nullable columns, so only priceValue and
  // ratingAvg may carry it.
  it('omits the nulls option when sorting by a non-nullable column', async () => {
    const { service, productFindMany } = buildService();

    await service.findAllFiltered({ sortBy: 'createdAt', sortOrder: 'desc' });

    const args = productFindMany.mock.calls[0][0] as never as {
      orderBy: Record<string, unknown>;
    };
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('keeps the nulls option when sorting by rating', async () => {
    const { service, productFindMany } = buildService();

    await service.findAllFiltered({ sortBy: 'rating', sortOrder: 'desc' });

    const args = productFindMany.mock.calls[0][0] as never as {
      orderBy: Record<string, unknown>;
    };
    expect(args.orderBy).toEqual({
      ratingAvg: { sort: 'desc', nulls: 'last' },
    });
  });

  it('filters to discounted products when onSale is set', async () => {
    const { service, productFindMany } = buildService();

    await service.findAllFiltered({ onSale: true });

    const args = productFindMany.mock.calls[0][0] as never as {
      where: { oldPrice?: unknown };
    };
    expect(args.where.oldPrice).toBeDefined();
  });

  // Matching goes through the canonical key, not a `Specification.id`: the id
  // belongs to one category's copy of the characteristic, so a selection made
  // on a parent category used to filter one subcategory and drop the subtree.
  it('applies one AND clause per selected specification, keyed canonically', async () => {
    const { service, productFindMany } = buildService();

    await service.findAllFiltered({
      specs: 'moshchnost~vt:750,900;napryazhenie~v:220',
    });

    const args = productFindMany.mock.calls[0][0] as never as {
      where: {
        AND?: Array<{ productSpecs: { some: Record<string, unknown> } }>;
      };
    };
    expect(args.where.AND).toHaveLength(2);
    expect(args.where.AND![0].productSpecs.some).toEqual({
      specification: { canonicalKey: 'moshchnost~vt' },
      valueNorm: { in: ['750', '900'] },
    });
    expect(args.where.AND![1].productSpecs.some).toEqual({
      specification: { canonicalKey: 'napryazhenie~v' },
      valueNorm: { in: ['220'] },
    });
  });

  it('adds no spec clause when nothing is selected', async () => {
    const { service, productFindMany } = buildService();

    await service.findAllFiltered({});

    const args = productFindMany.mock.calls[0][0] as never as {
      where: { AND?: unknown };
    };
    expect(args.where.AND).toBeUndefined();
  });

  it('filters by stock status when inStock is set', async () => {
    const { service, productFindMany } = buildService();
    await service.findAllFiltered({ inStock: true });

    const args = productFindMany.mock.calls[0][0] as never as {
      where: { stockStatus?: string };
    };
    expect(args.where.stockStatus).toBe('in_stock');
  });
});

describe('ProductService spec facets', () => {
  /** Wires the three queries `buildSpecFacets` makes, for one canonical key. */
  function stubFacet(
    prisma: PrismaService,
    options: {
      candidates: Array<{ canonicalKey: string; count: number }>;
      rows: Array<{
        id: string;
        canonicalKey: string;
        canonicalName: string;
        canonicalUnit: string | null;
      }>;
      values: Array<{
        specificationId: string;
        valueNorm: string | null;
        count: number;
      }>;
    },
  ) {
    jest.spyOn(prisma.specification, 'groupBy').mockResolvedValue(
      options.candidates.map((row) => ({
        canonicalKey: row.canonicalKey,
        _count: { _all: row.count },
      })) as never,
    );
    jest
      .spyOn(prisma.specification, 'findMany')
      .mockResolvedValue(options.rows as never);
    return jest.spyOn(prisma.productSpecification, 'groupBy').mockResolvedValue(
      options.values.map((row) => ({
        specificationId: row.specificationId,
        valueNorm: row.valueNorm,
        _count: { _all: row.count },
      })) as never,
    );
  }

  // The bug this whole canonical layer exists for: "Вес" is one Specification
  // row per category, so a parent category used to show it once per
  // subcategory, each copy holding a slice of the values.
  it('collapses one characteristic held by several categories into one facet', async () => {
    const { service, prisma } = buildService();
    stubFacet(prisma, {
      candidates: [{ canonicalKey: 'ves~kg', count: 3 }],
      rows: [
        {
          id: 's-c1',
          canonicalKey: 'ves~kg',
          canonicalName: 'Вес',
          canonicalUnit: 'кг',
        },
        {
          id: 's-c2',
          canonicalKey: 'ves~kg',
          canonicalName: 'Вес',
          canonicalUnit: 'кг',
        },
        {
          id: 's-c3',
          canonicalKey: 'ves~kg',
          canonicalName: 'Вес',
          canonicalUnit: 'кг',
        },
      ],
      values: [
        { specificationId: 's-c1', valueNorm: '1.5', count: 4 },
        { specificationId: 's-c2', valueNorm: '1.5', count: 6 },
        { specificationId: 's-c3', valueNorm: '2', count: 5 },
      ],
    });

    const result = await service.findAllFiltered({ categorySlug: 'elektro' });

    expect(result.facets.specs).toHaveLength(1);
    expect(result.facets.specs[0]).toMatchObject({
      id: 'ves~kg',
      name: 'Вес',
      unit: 'кг',
    });
    // The two "1.5" rows are one option whose count is the sum, not two options.
    expect(result.facets.specs[0].values).toEqual([
      { value: '1.5', count: 10 },
      { value: '2', count: 5 },
    ]);
  });

  it('picks the label most of the rows agree on', async () => {
    const { service, prisma } = buildService();
    stubFacet(prisma, {
      candidates: [{ canonicalKey: 'moshchnost~vt', count: 3 }],
      rows: [
        {
          id: 'a',
          canonicalKey: 'moshchnost~vt',
          canonicalName: 'Мощность',
          canonicalUnit: 'Вт',
        },
        {
          id: 'b',
          canonicalKey: 'moshchnost~vt',
          canonicalName: 'Мощность',
          canonicalUnit: 'Вт',
        },
        {
          id: 'c',
          canonicalKey: 'moshchnost~vt',
          canonicalName: 'Мощность двигателя',
          canonicalUnit: 'Вт',
        },
      ],
      values: [
        { specificationId: 'a', valueNorm: '750', count: 2 },
        { specificationId: 'c', valueNorm: '900', count: 1 },
      ],
    });

    const result = await service.findAllFiltered({ categorySlug: 'elektro' });
    expect(result.facets.specs[0].name).toBe('Мощность');
  });

  it('orders numeric options as numbers once their counts tie', async () => {
    const { service, prisma } = buildService();
    stubFacet(prisma, {
      candidates: [{ canonicalKey: 'moshchnost~vt', count: 1 }],
      rows: [
        {
          id: 'a',
          canonicalKey: 'moshchnost~vt',
          canonicalName: 'Мощность',
          canonicalUnit: 'Вт',
        },
      ],
      values: [
        { specificationId: 'a', valueNorm: '1000', count: 1 },
        { specificationId: 'a', valueNorm: '500', count: 1 },
        { specificationId: 'a', valueNorm: '750', count: 1 },
      ],
    });

    const result = await service.findAllFiltered({ categorySlug: 'elektro' });
    expect(result.facets.specs[0].values.map((v) => v.value)).toEqual([
      '500',
      '750',
      '1000',
    ]);
  });

  it('still hides identity characteristics an old import left enabled', async () => {
    const { service, prisma } = buildService();
    stubFacet(prisma, {
      candidates: [
        { canonicalKey: 'artikul', count: 5 },
        { canonicalKey: 'moshchnost~vt', count: 4 },
      ],
      rows: [
        {
          id: 'art',
          canonicalKey: 'artikul',
          canonicalName: 'Артикул',
          canonicalUnit: null,
        },
        {
          id: 'pow',
          canonicalKey: 'moshchnost~vt',
          canonicalName: 'Мощность',
          canonicalUnit: 'Вт',
        },
      ],
      values: [
        { specificationId: 'art', valueNorm: 'F-617', count: 1 },
        { specificationId: 'art', valueNorm: 'F-618', count: 1 },
        { specificationId: 'pow', valueNorm: '750', count: 3 },
        { specificationId: 'pow', valueNorm: '900', count: 2 },
      ],
    });

    const result = await service.findAllFiltered({ categorySlug: 'elektro' });
    expect(result.facets.specs.map((spec) => spec.name)).toEqual(['Мощность']);
  });

  it('drops a characteristic that offers only one option', async () => {
    const { service, prisma } = buildService();
    stubFacet(prisma, {
      candidates: [{ canonicalKey: 'cvet', count: 1 }],
      rows: [
        {
          id: 'a',
          canonicalKey: 'cvet',
          canonicalName: 'Цвет',
          canonicalUnit: null,
        },
      ],
      values: [{ specificationId: 'a', valueNorm: 'Синий', count: 9 }],
    });

    const result = await service.findAllFiltered({ categorySlug: 'elektro' });
    expect(result.facets.specs).toEqual([]);
  });

  // Power and blade diameter are not comparable across hammers and work
  // gloves, and aggregating to say so would scan the whole catalogue.
  it('offers no characteristic facets without a category in scope', async () => {
    const { service, prisma } = buildService();
    const candidates = jest.spyOn(prisma.specification, 'groupBy');

    const result = await service.findAllFiltered({});

    expect(result.facets.specs).toEqual([]);
    expect(candidates).not.toHaveBeenCalled();
  });
});
