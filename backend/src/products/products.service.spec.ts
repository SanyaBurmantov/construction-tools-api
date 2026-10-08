import { ProductService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';

const categories = [
  { id: 'c1', parentId: null, slug: 'elektro' },
  { id: 'c2', parentId: 'c1', slug: 'dreli' },
  { id: 'c3', parentId: 'c2', slug: 'akkum-dreli' },
  { id: 'c4', parentId: null, slug: 'krepezh' },
];

function buildService() {
  const productFindMany = jest.fn(() => Promise.resolve([]));
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

  it('applies one AND clause per selected specification', async () => {
    const { service, productFindMany } = buildService();

    await service.findAllFiltered({ specs: 'sp1:750 Вт,900 Вт;sp2:220 В' });

    const args = productFindMany.mock.calls[0][0] as never as {
      where: {
        AND?: Array<{ productSpecs: { some: Record<string, unknown> } }>;
      };
    };
    expect(args.where.AND).toHaveLength(2);
    expect(args.where.AND![0].productSpecs.some).toEqual({
      specificationId: 'sp1',
      value: { in: ['750 Вт', '900 Вт'] },
    });
    expect(args.where.AND![1].productSpecs.some).toEqual({
      specificationId: 'sp2',
      value: { in: ['220 В'] },
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

describe('ProductService legacy identity filters', () => {
  it('omits an enabled article spec while retaining useful characteristic facets', async () => {
    const { service, prisma } = buildService();
    jest.spyOn(prisma.specification, 'findMany').mockResolvedValue([
      { id: 'article', name: 'Артикул', unit: null, group: null },
      { id: 'power', name: 'Мощность', unit: 'Вт', group: null },
    ] as never);
    const groupBy = jest.spyOn(prisma.productSpecification, 'groupBy');
    groupBy.mockResolvedValue([
      { specificationId: 'power', value: '750', _count: { _all: 3 } },
      { specificationId: 'power', value: '900', _count: { _all: 2 } },
    ] as never);

    const result = await service.findAllFiltered({});
    expect(result.facets.specs.map((spec) => spec.name)).toEqual(['Мощность']);
    const args = groupBy.mock.calls[0][0] as {
      where: { specificationId: { in: string[] } };
    };
    expect(args.where.specificationId.in).toEqual(['power']);
  });
});
