import {
  ProductService,
  barcodeTerm,
  facetsCacheKey,
} from './products.service';
import { PrismaService } from '../prisma/prisma.service';

const categories = [
  { id: 'c1', parentId: null, slug: 'elektro', isVisible: true },
  { id: 'c2', parentId: 'c1', slug: 'dreli', isVisible: true },
  { id: 'c3', parentId: 'c2', slug: 'akkum-dreli', isVisible: true },
  { id: 'c4', parentId: null, slug: 'krepezh', isVisible: true },
  // Switched off by an admin: still a category, never an option.
  { id: 'c5', parentId: null, slug: 'avtotovary', isVisible: false },
];

/** Old slugs a collision or a merge left behind, as `CategoryRedirect` rows. */
const redirects: Record<string, { categoryId: string }> = {
  'elektro-old': { categoryId: 'c1' },
};

function buildService() {
  // Typed with its argument list: the tests read back the Prisma args this was
  // called with, and an untyped `jest.fn(() => …)` records calls as an empty
  // tuple, so `calls[0][0]` does not type-check.
  const productFindMany = jest.fn<Promise<unknown[]>, [unknown]>(() =>
    Promise.resolve([]),
  );
  const productCount = jest.fn<Promise<number>, [{ where?: unknown }]>(() =>
    Promise.resolve(0),
  );
  const productGroupBy = jest.fn<Promise<unknown[]>, [{ by?: string[] }]>(() =>
    Promise.resolve([]),
  );
  const productAggregate = jest.fn(() =>
    Promise.resolve({
      _min: { priceValue: 10.4 },
      _max: { priceValue: 99.6 },
    }),
  );
  const queryRaw = jest.fn(() => Promise.resolve([]));
  const categoryRedirectFindUnique = jest.fn(
    ({ where }: { where: { slug: string } }) =>
      Promise.resolve(redirects[where.slug] ?? null),
  );
  const prisma = {
    category: {
      findMany: jest.fn(() => Promise.resolve(categories)),
    },
    categoryRedirect: {
      findUnique: categoryRedirectFindUnique,
    },
    product: {
      findMany: productFindMany,
      count: productCount,
      groupBy: productGroupBy,
      aggregate: productAggregate,
      // Field references (used by the onSale column-to-column comparison).
      fields: { priceValue: { name: 'priceValue' } },
    },
    // The source facet counts products per supplier, so it reads the Source
    // table and then one product.count per row. No sources -> no counts.
    source: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    specification: {
      findMany: jest.fn(() => Promise.resolve([])),
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    productSpecification: {
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    $queryRaw: queryRaw,
    $executeRaw: jest.fn(() => Promise.resolve(1)),
  } as Record<string, unknown>;
  // Interactive transactions (the trigram-threshold wrapper) run inline.
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return {
    service: new ProductService(prisma as unknown as PrismaService),
    prisma: prisma as unknown as PrismaService,
    productCount,
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

  it('follows a CategoryRedirect alias to the whole subtree', async () => {
    const { service, productFindMany } = buildService();
    await service.findAllFiltered({ categorySlug: 'elektro-old' });

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

  // The storefront renders this facet as the subcategory links beside the
  // grid, so a `0` there is a link to a guaranteed-empty page. Reporting the
  // category at all is the bug, not the number beside it.
  it('omits categories that match nothing in the current context', async () => {
    const { service, productGroupBy } = buildService();
    productGroupBy.mockImplementation(
      (args: { by?: string[] }) =>
        Promise.resolve(
          args?.by?.includes('categoryId')
            ? [{ categoryId: 'c2', _count: { _all: 4 } }]
            : [],
        ) as never,
    );

    const result = await service.findAllFiltered({});

    // c1 carries c2's products through the subtree fold; c4 has none.
    expect(result.facets.categories).toEqual({ c1: 4 });
  });

  it('never offers a category an admin switched off', async () => {
    const { service, productGroupBy } = buildService();
    productGroupBy.mockImplementation(
      (args: { by?: string[] }) =>
        Promise.resolve(
          args?.by?.includes('categoryId')
            ? [
                { categoryId: 'c2', _count: { _all: 4 } },
                { categoryId: 'c5', _count: { _all: 7 } },
              ]
            : [],
        ) as never,
    );

    const result = await service.findAllFiltered({});

    expect(result.facets.categories).toEqual({ c1: 4 });
  });

  it('returns a rounded price range facet', async () => {
    const { service } = buildService();
    const result = await service.findAllFiltered({});
    expect(result.facets.priceRange).toEqual({ min: 10, max: 100 });
  });

  // The search used to be one OR across a join (name, sku, model, brand
  // name), which no index could serve: ~2 s per query on production, times
  // every facet. It is now one indexed, ranked query whose ids are the match;
  // counts and facets filter by them.
  it('matches by the full ranked id list, not by a capped window', async () => {
    const { service, productCount, queryRaw } = buildService();
    queryRaw.mockResolvedValue([{ id: 'p2' }, { id: 'p1' }] as never);

    await service.findAllFiltered({ search: ' DF333D ' });

    const where = productCount.mock.calls[0][0].where as {
      AND?: Array<{ id?: { in?: string[] } }>;
    };
    expect(where.AND?.[0]).toEqual({ id: { in: ['p2', 'p1'] } });
  });

  it('runs the search query once for the listing and its facets', async () => {
    const { service, queryRaw } = buildService();
    queryRaw.mockResolvedValue([{ id: 'p1' }] as never);

    await service.findAllFiltered({ search: 'дрель' });
    await service.findAllFiltered({ search: 'Дрель ', page: 2 });

    // The second call — same term, any case — comes from the cache.
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  // A one- or two-letter term can match most of the catalogue; past the cap
  // the relational clause takes over, so `total` stays the truth.
  it('falls back to the relational clause when the term matches too much', async () => {
    const { service, productCount, queryRaw } = buildService();
    queryRaw.mockResolvedValue(
      Array.from({ length: 20_001 }, (_, i) => ({ id: `p${i}` })) as never,
    );

    await service.findAllFiltered({ search: 'ка' });

    const where = productCount.mock.calls[0][0].where as {
      AND?: Array<{ OR?: Array<Record<string, unknown>> }>;
    };
    expect(where.AND?.[0]?.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: 'ка', mode: 'insensitive' } },
        { brand: { name: { contains: 'ка', mode: 'insensitive' } } },
      ]),
    );
  });

  it('orders the page by rank, not by the order the database returned', async () => {
    const { service, productFindMany, queryRaw } = buildService();
    queryRaw.mockResolvedValue([{ id: 'p2' }, { id: 'p1' }] as never);
    productFindMany
      // matches that pass the filters, in arbitrary DB order
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }] as never)
      // page rows fetched by id
      .mockResolvedValueOnce([
        {
          id: 'p1',
          images: [],
          productSpecs: [],
          _count: { sourceProducts: 2 },
        },
        {
          id: 'p2',
          images: [],
          productSpecs: [],
          _count: { sourceProducts: 0 },
        },
      ] as never);

    const result = await service.findAllFiltered({ search: ' DF333D ' });

    expect(result.data.map((row) => row.id)).toEqual(['p2', 'p1']);
  });

  it('pages through every match in rank order', async () => {
    const { service, productFindMany, queryRaw } = buildService();
    queryRaw.mockResolvedValue([
      { id: 'r1' },
      { id: 'r2' },
      { id: 'r3' },
    ] as never);
    productFindMany
      .mockResolvedValueOnce([
        { id: 'r3' },
        { id: 'r1' },
        { id: 'r2' },
      ] as never)
      .mockResolvedValueOnce([
        { id: 'r2', images: [], productSpecs: [], _count: null },
      ] as never);

    const result = await service.findAllFiltered({
      search: 'kluch',
      page: 2,
      limit: 1,
    });

    expect(result.data.map((row) => row.id)).toEqual(['r2']);
  });

  it('uses explicit sort instead of relevance when sortBy is set', async () => {
    const { service, productFindMany, queryRaw } = buildService();
    queryRaw.mockResolvedValue([{ id: 'p1' }] as never);

    await service.findAllFiltered({ search: 'дрель', sortBy: 'price' });

    const args = productFindMany.mock.calls[0][0] as never as {
      orderBy: Record<string, string>;
      where: { AND: Array<{ id?: { in?: string[] } }> };
    };
    expect(args.orderBy).toEqual({
      priceValue: { sort: 'asc', nulls: 'last' },
    });
    // the search still narrows the page
    expect(args.where.AND[0]).toEqual({ id: { in: ['p1'] } });
  });

  it('computes total and facets once per filter set, whatever the page', async () => {
    const { service, productCount } = buildService();

    await service.findAllFiltered({ categorySlug: 'dreli', page: 1 });
    await service.findAllFiltered({
      categorySlug: 'dreli',
      page: 2,
      sortBy: 'price',
    });
    expect(productCount).toHaveBeenCalledTimes(1);

    await service.findAllFiltered({ categorySlug: 'dreli', inStock: true });
    expect(productCount).toHaveBeenCalledTimes(2);
  });

  it('puts complete cards first in the default order', async () => {
    const { service, productFindMany } = buildService();

    await service.findAllFiltered({});

    const args = productFindMany.mock.calls[0][0] as never as {
      orderBy: unknown;
    };
    expect(args.orderBy).toEqual([{ listingRank: 'desc' }, { name: 'asc' }]);
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
        { specificationId: 'c', valueNorm: '900', count: 2 },
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
        { specificationId: 'a', valueNorm: '1000', count: 2 },
        { specificationId: 'a', valueNorm: '500', count: 2 },
        { specificationId: 'a', valueNorm: '750', count: 2 },
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

  // On `santehnika-2` the "Вес" facet offered 17 options — 0.0733, 1.28, 6.5 …
  // — each matching one product. Picking any of them is not filtering.
  it('drops a characteristic whose options each match a single product', async () => {
    const { service, prisma } = buildService();
    stubFacet(prisma, {
      candidates: [{ canonicalKey: 'ves~kg', count: 1 }],
      rows: [
        {
          id: 'a',
          canonicalKey: 'ves~kg',
          canonicalName: 'Вес',
          canonicalUnit: 'кг',
        },
      ],
      values: [
        { specificationId: 'a', valueNorm: '0.0733', count: 1 },
        { specificationId: 'a', valueNorm: '1.28', count: 1 },
        { specificationId: 'a', valueNorm: '6.5', count: 1 },
      ],
    });

    const result = await service.findAllFiltered({ categorySlug: 'elektro' });
    expect(result.facets.specs).toEqual([]);
  });

  it('keeps the shared options and trims the one-off tail', async () => {
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
      values: [
        { specificationId: 'a', valueNorm: 'Синий', count: 9 },
        { specificationId: 'a', valueNorm: 'Красный', count: 4 },
        { specificationId: 'a', valueNorm: 'Фуксия', count: 1 },
      ],
    });

    const result = await service.findAllFiltered({ categorySlug: 'elektro' });
    expect(result.facets.specs[0].values).toEqual([
      { value: 'Синий', count: 9 },
      { value: 'Красный', count: 4 },
    ]);
  });

  // An active filter has to stay visible, or there is no way to clear it.
  it('keeps a selected option even when only one product has it', async () => {
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
      values: [
        { specificationId: 'a', valueNorm: 'Синий', count: 9 },
        { specificationId: 'a', valueNorm: 'Фуксия', count: 1 },
      ],
    });

    const result = await service.findAllFiltered({
      categorySlug: 'elektro',
      specs: 'cvet:Фуксия',
    });
    expect(result.facets.specs[0].values.map((v) => v.value)).toEqual([
      'Синий',
      'Фуксия',
    ]);
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

  // The supplier facet is admin-only — which supplier carries a product is
  // internal — so the public listing neither exposes nor counts it. Counting
  // cost one semi-join over `SourceProduct` per supplier on every request and
  // every filter change, for numbers no visitor was ever shown. (It also used
  // to group `SourceProduct` rows, i.e. offers rather than products: prod read
  // "TH-Tools 34256" against 18427 real products.)
  it('does not expose or count a supplier facet', async () => {
    const { service, prisma } = buildService();
    const sourceQuery = jest.spyOn(prisma.source, 'findMany');

    const result = await service.findAllFiltered({});

    expect((result.facets as { sources?: unknown }).sources).toBeUndefined();
    expect(sourceQuery).not.toHaveBeenCalled();
  });
});

describe('public product payload', () => {
  // `include` returns every scalar on the row, so the catalogue JSON — and
  // with it the SSR payload in the page source — carried what we pay the
  // supplier. Counting `sourceProducts` instead of returning them was only
  // half the guarantee.
  it('strips the admin-only pricing columns from the list payload', async () => {
    const { service, productFindMany } = buildService();
    productFindMany.mockResolvedValueOnce([
      {
        id: 'p1',
        slug: 'drel',
        name: 'Дрель',
        priceValue: 120,
        oldPrice: null,
        costPrice: 80,
        pricingMode: 'AUTO',
        appliedRuleId: 'rule-1',
        priceReviewNeeded: true,
        matchBarcode: '123',
        matchSku: 'sku',
        matchModel: 'model',
        images: [
          { url: 'https://th-tool.by/site/themes/insales/img/default.png' },
          { url: 'https://th-tool.by/shop/products/real.970.webp' },
        ],
        productSpecs: [],
        _count: { sourceProducts: 2 },
      },
    ]);

    const result = await service.findAllFiltered({});
    const [product] = result.data as Array<Record<string, unknown>>;

    for (const field of [
      'costPrice',
      'pricingMode',
      'appliedRuleId',
      'priceReviewNeeded',
      'matchBarcode',
      'matchSku',
      'matchModel',
    ]) {
      expect(product).not.toHaveProperty(field);
    }
    // What the storefront does need stays.
    expect(product.priceValue).toBe(120);
    expect(product.offerCount).toBe(2);
    // …and the supplier's "нет фото" asset is not passed off as the photo.
    expect(product.images).toEqual([
      { url: 'https://th-tool.by/shop/products/real.970.webp' },
    ]);
  });
});

describe('barcodeTerm', () => {
  it('recognises EAN-8 … GTIN-14, spaces and dashes dropped', () => {
    expect(barcodeTerm('4810992031625')).toBe('4810992031625');
    expect(barcodeTerm('4 810992 031625')).toBe('4810992031625');
    expect(barcodeTerm('40170725')).toBe('40170725');
  });

  it('leaves articles and short numbers to the ordinary search', () => {
    expect(barcodeTerm('125266')).toBeNull();
    expect(barcodeTerm('GSB 13 RE')).toBeNull();
    expect(barcodeTerm('481099203162512')).toBeNull();
  });
});

describe('facetsCacheKey', () => {
  it('ignores page, limit and sort, and the order of selected brands', () => {
    expect(
      facetsCacheKey({ brandId: 'b,a', page: 3, limit: 48, sortBy: 'price' }),
    ).toBe(facetsCacheKey({ brandId: 'a, b' }));
  });

  it('tells apart every filter that changes the numbers', () => {
    const base = facetsCacheKey({ categorySlug: 'dreli' });
    expect(facetsCacheKey({ categorySlug: 'dreli', onSale: true })).not.toBe(
      base,
    );
    expect(facetsCacheKey({ categorySlug: 'dreli', priceMax: 100 })).not.toBe(
      base,
    );
    expect(facetsCacheKey({ categorySlug: 'dreli', search: 'Bosch' })).toBe(
      facetsCacheKey({ categorySlug: 'dreli', search: ' bosch ' }),
    );
    // Admin-only: a supplier filter must never share a customer's entry.
    expect(
      facetsCacheKey({ categorySlug: 'dreli', sourceCode: 'dukon' }),
    ).not.toBe(base);
  });
});
