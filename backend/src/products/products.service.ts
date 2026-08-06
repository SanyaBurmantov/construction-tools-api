import { CreateProductDto } from './dto/create-product-dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductFilterDto } from './dto/product-filter-dto';
import { searchVariants } from '../common/utils/transliterate';

const SEARCH_CANDIDATE_LIMIT = 1000;
/** word_similarity threshold: below this trigram matches are noise */
const SIMILARITY_THRESHOLD = 0.45;
/** trigram matching needs a few characters to mean anything */
const MIN_FUZZY_LENGTH = 4;

const LIST_INCLUDE = {
  brand: true,
  category: true,
  images: { orderBy: { order: 'asc' } },
  productSpecs: {
    include: { specification: true },
  },
  // Count only — the storefront shows "цена от X, N предложений"; supplier
  // links and our costs stay on the admin side.
  _count: { select: { sourceProducts: true } },
} satisfies Prisma.ProductInclude;

type ListProduct = Prisma.ProductGetPayload<{
  include: typeof LIST_INCLUDE;
}>;

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        slug: dto.slug,
        name: dto.name,
        categoryId: dto.categoryId,
        brandId: dto.brandId,
        priceValue: 0,
        priceCurrency: 'BYN',
        stockStatus: 'out_of_stock',
        status: 'DRAFT',
        seoTitle: dto.name,
        seoDescription: dto.name,
      },
    });
  }

  async getProductBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'PUBLISHED' },
      include: {
        brand: true,
        category: true,
        images: true,
        // Supplier rows are counted, never returned: they carry the purchase
        // URL and our cost, which must not leave the admin surface.
        sourceProducts: { select: { stock: true, price: true } },
        productSpecs: {
          include: { specification: true },
        },
      },
    });

    if (!product) {
      // The slug may belong to a product that was merged into another; tell the
      // caller where it went so the storefront can 301 instead of 404.
      const redirect = await this.prisma.productRedirect.findUnique({
        where: { slug },
        include: { product: { select: { slug: true, status: true } } },
      });
      if (redirect?.product && redirect.product.status === 'PUBLISHED') {
        throw new NotFoundException({
          message: 'Product moved',
          code: 'PRODUCT_MERGED',
          redirectTo: redirect.product.slug,
        });
      }
      throw new NotFoundException('Product not found');
    }

    const priced = product.sourceProducts.filter(
      (offer) => offer.price != null && offer.price > 0,
    );

    const { sourceProducts, ...rest } = product;
    void sourceProducts;

    return {
      ...rest,
      productSpecs: product.productSpecs.map((productSpec) => ({
        name: productSpec.specification.name,
        value: productSpec.value,
      })),
      /** How many suppliers carry this item — no prices, no links. */
      offers: {
        count: priced.length,
        inStockCount: priced.filter((offer) => offer.stock).length,
      },
    };
  }

  /** Slim list of published products for sitemap generation. */
  getSitemapEntries() {
    return this.prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findAll() {
    return this.prisma.product.findMany({
      include: {
        brand: true,
        category: true,
        productSpecs: {
          include: {
            specification: true,
          },
        },
        images: true,
        sourceProducts: true,
      },
    });
  }

  async findAllFiltered(filter: ProductFilterDto) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const categoryIds = await this.resolveCategoryIds(filter);
    const brandIds = filter.brandId
      ? filter.brandId
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : undefined;

    // Search resolves to a ranked id list first (trigram + transliteration);
    // the relational where then just narrows to those ids.
    const searchTerm = filter.search?.trim();
    const searchIds = searchTerm
      ? await this.searchProductIds(searchTerm)
      : undefined;

    // Where is rebuilt per facet with that facet's own dimension excluded,
    // so counts answer "what would I get if I picked this value instead".
    const buildWhere = (
      omit?: 'category' | 'brand' | 'source' | 'price',
    ): Prisma.ProductWhereInput => {
      const where: Prisma.ProductWhereInput = { status: 'PUBLISHED' };
      if (searchIds) {
        where.id = { in: searchIds };
      }
      if (filter.inStock) where.stockStatus = 'in_stock';
      // A product counts as discounted only when oldPrice really exceeds the
      // current price — parsers sometimes leave a stale oldPrice behind.
      if (filter.onSale) {
        where.oldPrice = { gt: this.prisma.product.fields.priceValue };
      }
      if (omit !== 'category' && categoryIds) {
        where.categoryId = { in: categoryIds };
      }
      if (omit !== 'brand' && brandIds?.length) {
        where.brandId = { in: brandIds };
      }
      if (omit !== 'source' && filter.sourceCode) {
        where.sourceProducts = {
          some: { source: { code: filter.sourceCode } },
        };
      }
      if (
        omit !== 'price' &&
        (filter.priceMin !== undefined || filter.priceMax !== undefined)
      ) {
        where.priceValue = {};
        if (filter.priceMin !== undefined)
          where.priceValue.gte = filter.priceMin;
        if (filter.priceMax !== undefined)
          where.priceValue.lte = filter.priceMax;
      }
      return where;
    };
    const where = buildWhere();

    const SORT_FIELDS = {
      price: 'priceValue',
      rating: 'ratingAvg',
      name: 'name',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    } as const;

    // `nulls` is only accepted on nullable columns, so it's opt-in per field.
    // For those, unpriced / unrated products sort last in either direction
    // instead of leading the list as NULLs.
    const NULLABLE_SORT_FIELDS = new Set<string>(['priceValue', 'ratingAvg']);

    const orderBy: Prisma.ProductOrderByWithRelationInput = (() => {
      if (!filter.sortBy) return { name: 'asc' };

      const field = SORT_FIELDS[filter.sortBy];
      const direction = filter.sortOrder ?? 'asc';

      return {
        [field]: NULLABLE_SORT_FIELDS.has(field)
          ? { sort: direction, nulls: 'last' }
          : direction,
      } as Prisma.ProductOrderByWithRelationInput;
    })();
    // no explicit sort + active search → keep the relevance ranking
    const useRelevance = !filter.sortBy && searchIds !== undefined;

    const [total, products, categoryCounts, brandCounts, sourceCounts, price] =
      await Promise.all([
        this.prisma.product.count({ where }),
        useRelevance
          ? this.findPageByRelevance(where, searchIds, skip, limit)
          : this.prisma.product.findMany({
              where,
              skip,
              take: limit,
              orderBy,
              include: LIST_INCLUDE,
            }),
        this.prisma.product.groupBy({
          by: ['categoryId'],
          where: buildWhere('category'),
          _count: { _all: true },
        }),
        this.prisma.product.groupBy({
          by: ['brandId'],
          where: { ...buildWhere('brand'), brandId: { not: null } },
          _count: { _all: true },
        }),
        this.prisma.sourceProduct.groupBy({
          by: ['sourceId'],
          where: { product: buildWhere('source') },
          _count: { _all: true },
        }),
        this.prisma.product.aggregate({
          where: { ...buildWhere('price'), priceValue: { gt: 0 } },
          _min: { priceValue: true },
          _max: { priceValue: true },
        }),
      ]);

    const facets = {
      categories: Object.fromEntries(
        categoryCounts.map((item) => [item.categoryId, item._count._all]),
      ),
      brands: Object.fromEntries(
        brandCounts
          .filter((item) => item.brandId)
          .map((item) => [item.brandId as string, item._count._all]),
      ),
      sources: Object.fromEntries(
        sourceCounts.map((item) => [item.sourceId, item._count._all]),
      ),
      priceRange:
        price._min.priceValue !== null
          ? {
              min: Math.floor(price._min.priceValue),
              max: Math.ceil(price._max.priceValue ?? price._min.priceValue),
            }
          : null,
    };

    const data = products.map((product) => {
      const { _count, ...rest } = product;
      return {
        ...rest,
        productSpecs: product.productSpecs.map((productSpec) => ({
          name: productSpec.specification.name,
          value: productSpec.value,
        })),
        /** Drives the "от X · N предложений" treatment on the card. */
        offerCount: _count?.sourceProducts ?? 0,
      };
    });

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      facets,
    };
  }

  /**
   * Page of products ordered by search relevance: the ranked id list from
   * searchProductIds defines the order, the relational where narrows it.
   */
  private async findPageByRelevance(
    where: Prisma.ProductWhereInput,
    rankedIds: string[],
    skip: number,
    limit: number,
  ): Promise<ListProduct[]> {
    const matching = await this.prisma.product.findMany({
      where,
      select: { id: true },
    });
    const position = new Map(rankedIds.map((id, index) => [id, index]));
    const pageIds = matching
      .map((row) => row.id)
      .sort(
        (a, b) =>
          (position.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (position.get(b) ?? Number.MAX_SAFE_INTEGER),
      )
      .slice(skip, skip + limit);

    const rows = await this.prisma.product.findMany({
      where: { id: { in: pageIds } },
      include: LIST_INCLUDE,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return pageIds
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }

  /**
   * Ranked full-text-ish search: exact/prefix SKU first, then name prefix,
   * substring matches, model/brand hits, and finally pg_trgm word similarity
   * for typo tolerance. Matches the term and its transliterations.
   */
  private async searchProductIds(
    term: string,
    limit = SEARCH_CANDIDATE_LIMIT,
  ): Promise<string[]> {
    const variants = searchVariants(term);
    if (!variants.length) return [];

    const matchClauses = variants.map((variant) => {
      const like = `%${variant}%`;
      const fuzzy =
        variant.length >= MIN_FUZZY_LENGTH
          ? Prisma.sql`OR word_similarity(${variant}, p."name") > ${SIMILARITY_THRESHOLD}`
          : Prisma.empty;
      return Prisma.sql`(
        p."name" ILIKE ${like}
        OR p."sku" ILIKE ${like}
        OR p."model" ILIKE ${like}
        OR b."name" ILIKE ${like}
        ${fuzzy}
      )`;
    });

    const rankClauses = variants.map((variant) => {
      const like = `%${variant}%`;
      const prefix = `${variant}%`;
      const fuzzy =
        variant.length >= MIN_FUZZY_LENGTH
          ? Prisma.sql`(word_similarity(${variant}, p."name") * 50)::int`
          : Prisma.sql`0`;
      return Prisma.sql`GREATEST(
        CASE WHEN lower(p."sku") = lower(${variant}) THEN 100 ELSE 0 END,
        CASE WHEN p."sku" ILIKE ${prefix} THEN 90 ELSE 0 END,
        CASE WHEN p."name" ILIKE ${prefix} THEN 75 ELSE 0 END,
        CASE WHEN p."name" ILIKE ${like} THEN 65 ELSE 0 END,
        CASE WHEN p."model" ILIKE ${like} THEN 60 ELSE 0 END,
        CASE WHEN b."name" ILIKE ${like} THEN 50 ELSE 0 END,
        ${fuzzy}
      )`;
    });

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p."id"
      FROM "Product" p
      LEFT JOIN "Brand" b ON b."id" = p."brandId"
      WHERE p."status" = 'PUBLISHED' AND (${Prisma.join(matchClauses, ' OR ')})
      ORDER BY GREATEST(${Prisma.join(rankClauses, ', ')}) DESC, p."name" ASC
      LIMIT ${limit}
    `);
    return rows.map((row) => row.id);
  }

  /** Live header suggestions: top products, categories and brands for a query. */
  async suggest(query: string) {
    const term = query?.trim() ?? '';
    if (term.length < 2) {
      return { products: [], categories: [], brands: [] };
    }

    const variants = searchVariants(term);
    const nameMatch = {
      OR: variants.map((variant) => ({
        name: { contains: variant, mode: 'insensitive' as const },
      })),
    };

    const ids = await this.searchProductIds(term, 6);
    const [rows, categories, brands] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          priceValue: true,
          priceCurrency: true,
          images: { orderBy: { order: 'asc' }, take: 1, select: { url: true } },
        },
      }),
      this.prisma.category.findMany({
        where: { ...nameMatch, products: { some: { status: 'PUBLISHED' } } },
        select: { id: true, name: true, slug: true },
        take: 4,
        orderBy: { name: 'asc' },
      }),
      this.prisma.brand.findMany({
        where: { ...nameMatch, products: { some: { status: 'PUBLISHED' } } },
        select: { id: true, name: true, slug: true },
        take: 4,
        orderBy: { name: 'asc' },
      }),
    ]);

    const byId = new Map(rows.map((row) => [row.id, row]));
    const products = ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map(({ images, ...row }) => ({ ...row, image: images[0]?.url ?? null }));

    return { products, categories, brands };
  }

  /**
   * Category filter covers the whole subtree: products live on leaf
   * categories, so picking a parent must include its descendants.
   * Returns undefined when no category filter is set, [] for unknown ones.
   */
  private async resolveCategoryIds(
    filter: ProductFilterDto,
  ): Promise<string[] | undefined> {
    if (!filter.categoryId && !filter.categorySlug) return undefined;

    const categories = await this.prisma.category.findMany({
      select: { id: true, parentId: true, slug: true },
    });
    const target = categories.find(
      (category) =>
        (filter.categoryId && category.id === filter.categoryId) ||
        (filter.categorySlug && category.slug === filter.categorySlug),
    );
    if (!target) return [];

    const childrenByParent = new Map<string, string[]>();
    for (const category of categories) {
      if (!category.parentId) continue;
      const list = childrenByParent.get(category.parentId) ?? [];
      list.push(category.id);
      childrenByParent.set(category.parentId, list);
    }

    const ids: string[] = [];
    const queue = [target.id];
    while (queue.length) {
      const id = queue.shift() as string;
      ids.push(id);
      queue.push(...(childrenByParent.get(id) ?? []));
    }
    return ids;
  }
}
