import { CreateProductDto } from './dto/create-product-dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductFilterDto } from './dto/product-filter-dto';
import { SpecSelection, parseSpecFilter } from './spec-filter';
import { searchVariants } from '../common/utils/transliterate';
import { shouldBeFilterable } from '../parser/spec-filterable';
import { withoutPlaceholderImages } from '../common/utils/product-images';

/**
 * How many products deep the relevance ranking goes.
 *
 * This is an *ordering* budget, not a membership one. It used to be both: the
 * ranked id list was fed into `where: { id: { in: … } }`, so a search for
 * "ключ", "набор" or "масло" answered `total: 1000` exactly — the cap, not the
 * truth — and the facets, the price range and the sort were all computed over
 * an arbitrary thousand rows. Membership is now a relational clause, so counts
 * and facets cover every match; this only decides how far the "most relevant
 * first" order extends before falling back to alphabetical.
 */
const SEARCH_RANK_LIMIT = 2000;

/**
 * Trigram similarity is the one part of the match that cannot be written as a
 * Prisma filter, so typo-tolerant hits still arrive as an id list and are
 * OR'ed into the clause. Bounded because, unlike a substring match, this one
 * can touch a large slice of the catalogue at a low threshold.
 */
const FUZZY_MATCH_LIMIT = 2000;
/** How many characteristics a category page offers as filters. */
const SPEC_FACET_LIMIT = 40;
/** How many options one characteristic offers. */
const SPEC_FACET_VALUE_LIMIT = 30;
/**
 * An option has to narrow the list to be worth offering.
 *
 * Supplier feeds carry free-text measurements, so a characteristic often has
 * one distinct value per product: on `santehnika-2` the "Вес" facet offered 17
 * options — `0.0733`, `1.28`, `6.5` … — each matching a single product. That
 * is a list of products wearing a filter's clothes. Values below this count
 * are dropped, and a characteristic needs at least two that survive, which is
 * the same "a filter with one option filters nothing" rule applied to options
 * that actually do something.
 */
const MIN_FACET_VALUE_COUNT = 2;
const MIN_FACET_VALUES = 2;
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

/**
 * Columns that must never leave the admin surface.
 *
 * `include` hands back every scalar on `Product`, and the storefront payload
 * used to be the whole row spread into the response — so `costPrice` (what we
 * pay the supplier) and the pricing bookkeeping beside it were readable in the
 * catalogue JSON and, through the SSR payload, in the page source of every
 * product card. Counting `sourceProducts` instead of returning them was only
 * half the guarantee; this is the other half.
 */
const ADMIN_ONLY_PRODUCT_FIELDS = [
  'costPrice',
  'pricingMode',
  'appliedRuleId',
  'priceReviewNeeded',
  'matchBarcode',
  'matchSku',
  'matchModel',
] as const;

type AdminOnlyProductField = (typeof ADMIN_ONLY_PRODUCT_FIELDS)[number];

/** Drops the admin-only columns from a row headed for a public response. */
function toPublicProduct<
  T extends Partial<Record<AdminOnlyProductField, unknown>>,
>(product: T): Omit<T, AdminOnlyProductField> {
  const rest = { ...product };
  for (const field of ADMIN_ONLY_PRODUCT_FIELDS) delete rest[field];
  return rest as Omit<T, AdminOnlyProductField>;
}

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
      ...toPublicProduct(rest),
      // The gallery feeds `og:image` and the product JSON-LD as well as the
      // page, so a supplier's "нет фото" asset would be what we hand Google
      // as the product photo.
      images: withoutPlaceholderImages(product.images),
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

  /**
   * Value facets for the characteristics of the categories currently in scope.
   *
   * Grouped by **canonical key**, not by `Specification.id`. `Specification` is
   * keyed by `(categoryId, key)`, so "Вес" is one row per category — 773 of
   * them in production. Returning one facet per row put "Вес" in the sidebar
   * ten times on any parent category, each copy holding a slice of the values.
   * Grouping by `canonicalKey` (`parser/spec-canonical.ts`) folds those back
   * into one filter, and folds the supplier spellings with them: all four of
   * `Мощность ( Вт )`, `Мощность (Вт)`, `Мощность, Вт` and `Мощность, Вт.`
   * share a key.
   *
   * Each characteristic's counts are computed with its *own* selection removed,
   * so ticking "750 Вт" doesn't collapse the power filter to a single option —
   * the same rule the brand and price facets already follow. Characteristics
   * the user hasn't touched share one query; each selected one costs an extra
   * query, and there are rarely more than a few of those.
   */
  private async buildSpecFacets(
    categoryIds: string[] | undefined,
    selections: SpecSelection[],
    buildWhere: (
      omit?: 'category' | 'brand' | 'source' | 'price' | 'specs',
      omitSpecKey?: string,
    ) => Prisma.ProductWhereInput,
  ) {
    // Without a category there is nothing sensible to offer: power and blade
    // diameter are not comparable across hammers and work gloves, and the
    // aggregation would run over the whole catalogue to say so. The previous
    // code took the alphabetically first 40 characteristics of all 15k, which
    // is why the root catalogue page showed an arbitrary set of filters.
    if (!categoryIds?.length) return [];

    const inScope: Prisma.SpecificationWhereInput = {
      filterable: true,
      canonicalKey: { not: null },
      categoryId: { in: categoryIds },
    };

    // Candidates first, so the value aggregation is bounded. Ranked by how
    // many of the categories in scope use the characteristic — a far better
    // proxy for usefulness than the name's position in the alphabet.
    const candidates = await this.prisma.specification.groupBy({
      by: ['canonicalKey'],
      where: inScope,
      _count: { _all: true },
      orderBy: { _count: { canonicalKey: 'desc' } },
      take: SPEC_FACET_LIMIT,
    });

    const keys = candidates
      .map((row) => row.canonicalKey)
      .filter((key): key is string => Boolean(key));
    if (!keys.length) return [];

    // Labels: rows sharing a key can disagree on spelling, so the label is the
    // most common `canonicalName` among them. The normalizer converges these,
    // but a freshly parsed row may still be the odd one out.
    const labelRows = await this.prisma.specification.findMany({
      where: { ...inScope, canonicalKey: { in: keys } },
      select: { canonicalKey: true, canonicalName: true, canonicalUnit: true },
    });

    const labels = this.pickSpecLabels(labelRows);
    const selectedKeys = new Set(selections.map((s) => s.specKey));
    const selectedValues = new Map(
      selections.map((selection) => [
        selection.specKey,
        new Set(selection.values),
      ]),
    );

    // The relation filter is what makes grouping by canonical key possible
    // without listing thousands of specification ids in an IN clause.
    const groupFor = (omitSpecKey?: string, only?: string[]) =>
      this.prisma.productSpecification.groupBy({
        by: ['specificationId', 'valueNorm'],
        where: {
          valueNorm: { not: null },
          specification: { ...inScope, canonicalKey: { in: only ?? keys } },
          product: buildWhere(undefined, omitSpecKey),
        },
        _count: { _all: true },
      });

    const unselected = keys.filter((key) => !selectedKeys.has(key));
    const grouped = await Promise.all([
      ...(unselected.length ? [groupFor(undefined, unselected)] : []),
      ...[...selectedKeys]
        .filter((key) => keys.includes(key))
        .map((key) => groupFor(key, [key])),
    ]);

    // groupBy can only group by scalars, so the rows come back per
    // specification id and are folded into their canonical key here.
    const specKeyById = new Map(
      (
        await this.prisma.specification.findMany({
          where: { ...inScope, canonicalKey: { in: keys } },
          select: { id: true, canonicalKey: true },
        })
      ).map((row) => [row.id, row.canonicalKey as string]),
    );

    const counts = new Map<string, Map<string, number>>();
    for (const row of grouped.flat()) {
      const key = specKeyById.get(row.specificationId);
      if (!key || row.valueNorm === null) continue;

      const bucket = counts.get(key) ?? new Map<string, number>();
      bucket.set(
        row.valueNorm,
        (bucket.get(row.valueNorm) ?? 0) + row._count._all,
      );
      counts.set(key, bucket);
    }

    return (
      keys
        .map((key) => {
          const label = labels.get(key);
          return {
            // The frontend treats this as an opaque filter id and puts it in the
            // `specs` query parameter, which is exactly what it now is.
            id: key,
            name: label?.name ?? key,
            unit: label?.unit ?? null,
            group: null,
            values: [...(counts.get(key) ?? new Map<string, number>())]
              .map(([value, count]) => ({ value, count }))
              // A value the visitor has already ticked stays, whatever its
              // count — otherwise an active filter would vanish from the
              // sidebar and could not be cleared.
              .filter(
                ({ value, count }) =>
                  count >= MIN_FACET_VALUE_COUNT ||
                  selectedValues.get(key)?.has(value),
              )
              // Most-common values first: the long tail of one-off values from
              // supplier feeds shouldn't push the useful options out of sight.
              .sort(
                (a, b) =>
                  b.count - a.count || compareFacetValues(a.value, b.value),
              )
              .slice(0, SPEC_FACET_VALUE_LIMIT),
          };
        })
        // Old imports may still have enabled identity fields such as Артикул.
        .filter((spec) => shouldBeFilterable(spec.name))
        // A filter with fewer than two usable options filters nothing.
        .filter((spec) => spec.values.length >= MIN_FACET_VALUES)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    );
  }

  /**
   * One label per canonical key: the spelling most of the rows agree on, with
   * the name as the tie-break so the choice is stable between requests.
   */
  private pickSpecLabels(
    rows: Array<{
      canonicalKey: string | null;
      canonicalName: string | null;
      canonicalUnit: string | null;
    }>,
  ) {
    const tally = new Map<string, Map<string, number>>();
    const units = new Map<string, string | null>();

    for (const row of rows) {
      if (!row.canonicalKey) continue;
      const names = tally.get(row.canonicalKey) ?? new Map<string, number>();
      const name = row.canonicalName?.trim();
      if (name) names.set(name, (names.get(name) ?? 0) + 1);
      tally.set(row.canonicalKey, names);
      if (!units.has(row.canonicalKey)) {
        units.set(row.canonicalKey, row.canonicalUnit);
      }
    }

    const labels = new Map<string, { name: string; unit: string | null }>();
    for (const [key, names] of tally) {
      const best = [...names].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'),
      )[0];
      if (!best) continue;
      labels.set(key, { name: best[0], unit: units.get(key) ?? null });
    }

    return labels;
  }

  /** Slim list of published products for sitemap generation. */
  getSitemapEntries() {
    return this.prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findAllFiltered(filter: ProductFilterDto) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const { filterIds: categoryIds, facetScope } =
      await this.loadCategoryScope(filter);
    const brandIds = filter.brandId
      ? filter.brandId
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : undefined;

    // Membership is a relational clause, so every count below covers the whole
    // match; the ranked id list that follows only decides the order.
    const searchTerm = filter.search?.trim();
    const searchWhere = searchTerm
      ? await this.buildSearchWhere(searchTerm)
      : undefined;

    const specSelections = parseSpecFilter(filter.specs);

    // Where is rebuilt per facet with that facet's own dimension excluded,
    // so counts answer "what would I get if I picked this value instead".
    // `omitSpecId` does the same for one specification's own values.
    const buildWhere = (
      omit?: 'category' | 'brand' | 'source' | 'price' | 'specs',
      omitSpecKey?: string,
    ): Prisma.ProductWhereInput => {
      const where: Prisma.ProductWhereInput = { status: 'PUBLISHED' };
      // Collected and applied as one AND below, because the spec filters want
      // `AND` too and the last writer would otherwise win.
      const and: Prisma.ProductWhereInput[] = [];
      if (searchWhere) and.push(searchWhere);
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

      // One AND clause per selected characteristic: values inside one are
      // alternatives, different characteristics must all hold.
      //
      // Matching goes through the canonical key and the normalized value, so a
      // selection made on a parent category keeps working across the whole
      // subtree — each subcategory has its own `Specification` row, and they
      // all share the canonical key.
      if (omit !== 'specs') {
        const applicable = specSelections.filter(
          (selection) => selection.specKey !== omitSpecKey,
        );
        for (const selection of applicable) {
          and.push({
            productSpecs: {
              some: {
                specification: { canonicalKey: selection.specKey },
                valueNorm: { in: selection.values },
              },
            },
          });
        }
      }

      if (and.length) where.AND = and;
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
    const useRelevance = !filter.sortBy && searchTerm !== undefined;

    const specFacets = await this.buildSpecFacets(
      categoryIds,
      specSelections,
      buildWhere,
    );

    const [total, products, categoryCounts, brandCounts, sourceCounts, price] =
      await Promise.all([
        this.prisma.product.count({ where }),
        useRelevance && searchTerm
          ? this.findPageByRelevance(where, searchTerm, skip, limit)
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

    // Per-leaf counts, folded into one subtree total per category the sidebar
    // renders. The frontend used to do this fold itself, which is why the map
    // had to carry every category in the catalogue.
    const leafCounts = new Map(
      categoryCounts.map((item) => [item.categoryId, item._count._all]),
    );
    const facets = {
      // Categories that match nothing in the current context are left out
      // entirely rather than reported as `0`. A zero is not a filter the
      // visitor can use: the storefront rendered those rows as "Дрели 0",
      // links to a grid guaranteed to be empty.
      categories: Object.fromEntries(
        facetScope
          .map(
            (node) =>
              [
                node.id,
                node.descendants.reduce(
                  (sum, id) => sum + (leafCounts.get(id) ?? 0),
                  0,
                ),
              ] as const,
          )
          .filter(([, count]) => count > 0),
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
      specs: specFacets,
    };

    const data = products.map((product) => {
      const { _count, ...rest } = product;
      return {
        ...toPublicProduct(rest),
        images: withoutPlaceholderImages(product.images),
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
    term: string,
    skip: number,
    limit: number,
  ): Promise<ListProduct[]> {
    const rankedIds = await this.searchProductIds(term);
    const position = new Map(rankedIds.map((id, index) => [id, index]));

    // The ranked window, narrowed by the active filters and kept in rank
    // order. Bounded by SEARCH_RANK_LIMIT, so this list stays small even when
    // the term matches most of the catalogue — which is the whole point of
    // separating it from membership.
    const ranked = rankedIds.length
      ? (
          await this.prisma.product.findMany({
            where: { AND: [where, { id: { in: rankedIds } }] },
            select: { id: true },
          })
        )
          .map((row) => row.id)
          .sort(
            (a, b) =>
              (position.get(a) ?? Number.MAX_SAFE_INTEGER) -
              (position.get(b) ?? Number.MAX_SAFE_INTEGER),
          )
      : [];

    const pageIds = ranked.slice(skip, skip + limit);

    // Matches the ranking never reached still have to be reachable: they come
    // after everything ranked, alphabetically, and Postgres paginates them
    // rather than this process holding every id in memory.
    if (pageIds.length < limit) {
      const tail = await this.prisma.product.findMany({
        where: rankedIds.length
          ? { AND: [where, { id: { notIn: rankedIds } }] }
          : where,
        select: { id: true },
        orderBy: { name: 'asc' },
        skip: Math.max(0, skip - ranked.length),
        take: limit - pageIds.length,
      });
      pageIds.push(...tail.map((row) => row.id));
    }

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
   * Which products a term matches, as a Prisma filter.
   *
   * Everything except trigram similarity is expressible relationally, so the
   * match becomes part of `where` and Postgres counts it with its own indexes.
   * That is what makes `total`, the facets and the price range describe the
   * real result set rather than the first page of a ranked id list.
   *
   * Typo tolerance is the exception — `word_similarity` has no Prisma
   * equivalent — so those ids are fetched separately and OR'ed in.
   */
  private async buildSearchWhere(
    term: string,
  ): Promise<Prisma.ProductWhereInput | undefined> {
    const variants = searchVariants(term);
    // No usable variants means the term was punctuation: match nothing rather
    // than silently dropping the filter and returning the whole catalogue.
    if (!variants.length) return { id: { in: [] } };

    const substring: Prisma.ProductWhereInput[] = variants.flatMap(
      (variant) => {
        const contains = { contains: variant, mode: 'insensitive' as const };
        return [
          { name: contains },
          { sku: contains },
          { model: contains },
          { brand: { name: contains } },
        ];
      },
    );

    const fuzzyIds = await this.fuzzyMatchIds(variants);
    return {
      OR: fuzzyIds.length
        ? [...substring, { id: { in: fuzzyIds } }]
        : substring,
    };
  }

  /** Trigram-similar product ids — the typo-tolerant half of the match. */
  private async fuzzyMatchIds(variants: string[]): Promise<string[]> {
    const fuzzable = variants.filter(
      (variant) => variant.length >= MIN_FUZZY_LENGTH,
    );
    if (!fuzzable.length) return [];

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p."id"
      FROM "Product" p
      WHERE p."status" = 'PUBLISHED'
        AND (${Prisma.join(
          fuzzable.map(
            (variant) =>
              Prisma.sql`word_similarity(${variant}, p."name") > ${SIMILARITY_THRESHOLD}`,
          ),
          ' OR ',
        )})
      LIMIT ${FUZZY_MATCH_LIMIT}
    `);
    return rows.map((row) => row.id);
  }

  /**
   * Ranked full-text-ish search: exact/prefix SKU first, then name prefix,
   * substring matches, model/brand hits, and finally pg_trgm word similarity
   * for typo tolerance. Matches the term and its transliterations.
   *
   * Used only to order results now — see `SEARCH_RANK_LIMIT`.
   */
  private async searchProductIds(
    term: string,
    limit = SEARCH_RANK_LIMIT,
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
          images: { orderBy: { order: 'asc' }, select: { url: true } },
        },
      }),
      this.prisma.category.findMany({
        // `isVisible` is an admin decision to keep a branch out of navigation;
        // a search suggestion is navigation.
        where: {
          ...nameMatch,
          isVisible: true,
          products: { some: { status: 'PUBLISHED' } },
        },
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
      .map(({ images, ...row }) => ({
        ...row,
        image: withoutPlaceholderImages(images)[0]?.url ?? null,
      }));

    return { products, categories, brands };
  }

  /**
   * The category context for one request: which ids the filter covers, and
   * which categories the sidebar will render counts for.
   *
   * Both come from the same single read of the category table — the filter
   * needs the target's whole subtree (products hang off leaves, so picking a
   * parent must include its descendants) and the facet needs one aggregated
   * number per rendered node.
   */
  private async loadCategoryScope(filter: ProductFilterDto): Promise<{
    /** Subtree of the filtered category; undefined when nothing is filtered. */
    filterIds: string[] | undefined;
    /** Categories the facet reports on, each with its descendants. */
    facetScope: Array<{ id: string; descendants: string[] }>;
  }> {
    const categories = await this.prisma.category.findMany({
      select: { id: true, parentId: true, slug: true, isVisible: true },
    });

    const childrenByParent = new Map<string, string[]>();
    for (const category of categories) {
      const key = category.parentId ?? '';
      const list = childrenByParent.get(key) ?? [];
      list.push(category.id);
      childrenByParent.set(key, list);
    }
    const descendantsOf = (id: string) => {
      const ids: string[] = [];
      const queue = [id];
      while (queue.length) {
        const current = queue.shift() as string;
        ids.push(current);
        queue.push(...(childrenByParent.get(current) ?? []));
      }
      return ids;
    };

    const target =
      filter.categoryId || filter.categorySlug
        ? ((await this.resolveTargetCategory(filter, categories)) ?? null)
        : undefined;

    // `undefined` target → no filter; `null` → a filter nobody matches.
    const filterIds =
      target === undefined
        ? undefined
        : target === null
          ? []
          : descendantsOf(target.id);

    // The storefront lists the current category's children, or the roots at
    // the top level, and shows a subtree total beside each. Reporting every
    // category instead sent the whole 1500-row map on every request — half the
    // response — for a sidebar that renders a few dozen rows.
    const scopeParents = target
      ? (childrenByParent.get(target.id) ?? [])
      : target === null
        ? []
        : (childrenByParent.get('') ?? []);

    // A branch an admin switched off is not a navigable option, so it must not
    // be offered as one — the storefront renders this facet as the
    // subcategory links beside the grid.
    const visible = new Set(
      categories.filter((category) => category.isVisible).map((c) => c.id),
    );

    return {
      filterIds,
      facetScope: scopeParents
        .filter((id) => visible.has(id))
        .map((id) => ({
          id,
          descendants: descendantsOf(id),
        })),
    };
  }

  /** The category a `categoryId` / `categorySlug` filter points at. */
  private async resolveTargetCategory(
    filter: ProductFilterDto,
    categories: Array<{ id: string; parentId: string | null; slug: string }>,
  ) {
    const target = categories.find(
      (category) =>
        (filter.categoryId && category.id === filter.categoryId) ||
        (filter.categorySlug && category.slug === filter.categorySlug),
    );
    if (target) return target;
    // A slug collision or a merge leaves the old slug behind as a
    // `CategoryRedirect`. `GET /categories/:slug` follows those, so the
    // category page resolved while this filter returned an empty list — the
    // header claimed 9609 products above an empty grid.
    if (filter.categorySlug) {
      const alias = await this.prisma.categoryRedirect.findUnique({
        where: { slug: filter.categorySlug },
        select: { categoryId: true },
      });
      if (alias) {
        return categories.find((category) => category.id === alias.categoryId);
      }
    }
    return undefined;
  }
}

/**
 * Orders two facet options. Numeric options sort as numbers, so a power filter
 * reads 500 · 750 · 1000 rather than 1000 · 500 · 750; everything else falls
 * back to Russian collation.
 */
function compareFacetValues(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return a.localeCompare(b, 'ru');
}
