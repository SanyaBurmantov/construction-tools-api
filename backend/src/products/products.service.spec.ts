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
  const prisma = {
    category: {
      findMany: jest.fn(() => Promise.resolve(categories)),
    },
    product: {
      findMany: productFindMany,
      count: productCount,
      groupBy: productGroupBy,
      aggregate: productAggregate,
    },
    sourceProduct: {
      groupBy: jest.fn(() => Promise.resolve([])),
    },
  } as unknown as PrismaService;
  return {
    service: new ProductService(prisma),
    productFindMany,
    productGroupBy,
    productAggregate,
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

  it('searches across name, sku, model and brand name', async () => {
    const { service, productFindMany } = buildService();
    await service.findAllFiltered({ search: ' DF333D ' });

    const args = productFindMany.mock.calls[0][0] as never as {
      where: { OR: Array<Record<string, unknown>> };
    };
    const fields = args.where.OR.map((clause) => Object.keys(clause)[0]);
    expect(fields).toEqual(['name', 'sku', 'model', 'brand']);
    // the term is trimmed before matching
    expect(args.where.OR[0]).toEqual({
      name: { contains: 'DF333D', mode: 'insensitive' },
    });
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
