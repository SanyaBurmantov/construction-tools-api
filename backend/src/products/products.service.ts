import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductFilterDto } from './dto/product-filter-dto';
import { SpecSelection, parseSpecFilter } from './spec-filter';
import { searchVariants } from '../common/utils/transliterate';
import { isIdentitySpec, publicSpecs } from '../parser/spec-filterable';
import { withoutPlaceholderImages } from '../common/utils/product-images';

/**
 * How many matches the indexed search collects, in relevance order.
 *
 * Membership and order come from one query now (see `rankedMatchIds`): each
 * condition is its own `UNION` branch, so every branch is served by its own
 * trigram index instead of one `OR` across a join forcing a scan of the whole
 * catalogue — «перфоратор» went from ~2 s to ~0.1 s on production. Counts and
 * facets then filter by that id list. A term matching more than this (one or
 * two letters) falls back to the relational clause, so `total` is never the
 * cap instead of the truth — that was the bug of the old 1000-row list.
 */
const SEARCH_MATCH_LIMIT = 20_000;

/**
 * `total` and the facets of a listing, per filter set. They do not depend on
 * the page or the sort, and computing them is most of a listing's cost: a
 * count plus a groupBy per dimension (category, brand, price, specs) over the
 * whole filtered catalogue — ~0.5 s on production for every page turn and
 * sort change. The catalogue changes when parsers run, so two minutes stale
 * is invisible; prices on the cards themselves are never cached here.
 */
const FACETS_CACHE_TTL_MS = 120_000;
const FACETS_CACHE_MAX_ENTRIES = 300;

/** Repeated searches (autocomplete, filter changes) reuse the id list. */
const SEARCH_CACHE_TTL_MS = 60_000;
const SEARCH_CACHE_MAX_ENTRIES = 100;
/** Only modest lists are cached — a bounded heap matters more than a hit. */
const SEARCH_CACHE_MAX_IDS = 5_000;

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

/**
 * A search term that is a barcode (EAN-8 … GTIN-14), spaces dropped, or null.
 * Matched as a whole code, never as a substring: eight digits inside a
 * barcode are not that product. Suppliers store a second code beside the main
 * one as `4810992031625 (4811207007213)`, so both positions are matched.
 */
/**
 * The cache key of a listing's total + facets: every filter that changes
 * them, and nothing that does not (page, limit, sort). Pure.
 */
export function facetsCacheKey(filter: ProductFilterDto): string {
  return JSON.stringify([
    filter.categorySlug ?? null,
    filter.categoryId ?? null,
    filter.brandId
      ? filter.brandId
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
          .sort()
          .join(',')
      : null,
    filter.sourceCode ?? null,
    filter.priceMin ?? null,
    filter.priceMax ?? null,
    Boolean(filter.inStock),
    Boolean(filter.onSale),
    filter.specs ?? null,
    filter.search?.trim().toLowerCase() || null,
  ]);
}

export function barcodeTerm(term: string): string | null {
  const digits = term.replace(/[\s-]/g, '');
  return /^\d{8,14}$/.test(digits) ? digits : null;
}

/**
 * The category as the storefront uses it (breadcrumb, related products).
 * The whole row also carried `pathKey`/`path` — the supplier's breadcrumb
 * slugs — and the admin's curation fields.
 */
const PUBLIC_CATEGORY_SELECT = {
  select: { id: true, name: true, slug: true, parentId: true },
} as const;

const LIST_INCLUDE = {
  brand: true,
  category: PUBLIC_CATEGORY_SELECT,
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
  // Which texts an AI or an admin rewrote, and who set the status, are
  // editorial bookkeeping, not product data.
  'aiLockedFields',
  'lockedFields',
  'statusSource',
] as const;

type AdminOnlyProductField = (typeof ADMIN_ONLY_PRODUCT_FIELDS)[number];

/**
 * SEO fields the storefront may use. What a parser stored there is the
 * supplier's own blurb — «купить в Минске», their phone — so the product page
 * used to ignore both columns and build its own. Only a text we wrote (an AI
 * task or an admin edit, both of which lock the field) is passed on; the rest
 * goes out as `null` and the page keeps its template.
 */
const OWN_SEO_FIELDS = ['seoTitle', 'seoDescription'] as const;

/** Drops the admin-only columns from a row headed for a public response. */
function toPublicProduct<
  T extends Partial<Record<AdminOnlyProductField, unknown>>,
>(product: T): Omit<T, AdminOnlyProductField> {
  const rest: Record<string, unknown> = { ...product };
  const own = new Set([
    ...((product.aiLockedFields as string[] | undefined) ?? []),
    ...((product.lockedFields as string[] | undefined) ?? []),
  ]);
  for (const field of OWN_SEO_FIELDS) {
    if (field in rest && !own.has(field)) rest[field] = null;
  }
  for (const field of ADMIN_ONLY_PRODUCT_FIELDS) delete rest[field];
  return rest as Omit<T, AdminOnlyProductField>;
}

const CATEGORY_CACHE_TTL_MS = 30_000;

type CategoryIndexRow = {
  id: string;
  parentId: string | null;
  slug: string;
  isVisible: boolean;
};

/** User input inside a raw ILIKE pattern: `%` and `_` are literal. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  async getProductBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'PUBLISHED' },
      include: {
        brand: true,
        category: PUBLIC_CATEGORY_SELECT,
        images: { orderBy: { order: 'asc' } },
        // Supplier rows are counted, never returned: they carry the purchase
        // URL and our cost, which must not leave the admin surface.
        sourceProducts: {
          select: { stock: true, price: true, lastSync: true },
        },
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
      // Supplier paperwork («Поставщик», «Импортер/Продавец», the supplier's
      // «Код», a manufacturer's legal address) stays in the database and the
      // admin API; the storefront gets consumer properties, those first.
      productSpecs: publicSpecs(
        product.productSpecs.map((productSpec) => ({
          name: productSpec.specification.name,
          value: productSpec.value,
        })),
      ),
      /** How many suppliers carry this item — no prices, no links. */
      offers: {
        count: priced.length,
        inStockCount: priced.filter((offer) => offer.stock).length,
      },
      /**
       * When the price was last checked against a supplier — the newest
       * offer sync. Shown as «Цена обновлена …» and the base of the
       * JSON-LD `priceValidUntil`. Null for a product with no offer.
       */
      priceCheckedAt:
        priced
          .map((offer) => offer.lastSync)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
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
    // One read serves both the labels and the id → key map used to fold the
    // grouped counts below (it used to be two identical queries).
    const labelRows = await this.prisma.specification.findMany({
      where: { ...inScope, canonicalKey: { in: keys } },
      select: {
        id: true,
        canonicalKey: true,
        canonicalName: true,
        canonicalUnit: true,
      },
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
      labelRows.map((row) => [row.id, row.canonicalKey as string]),
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
        .filter((spec) => !isIdentitySpec(spec.name))
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
  /**
   * `lastmod` is when the page text changed (`contentUpdatedAt`), not
   * `updatedAt`: every product is re-parsed daily, and a sitemap where all
   * 74k URLs changed "today" is one search engines stop believing.
   */
  async getSitemapEntries() {
    const rows = await this.prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      select: { slug: true, contentUpdatedAt: true },
      orderBy: { contentUpdatedAt: 'desc' },
    });
    return rows.map((row) => ({
      slug: row.slug,
      lastmod: row.contentUpdatedAt,
    }));
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
    const rankedIds = searchTerm
      ? await this.rankedMatchIds(searchTerm)
      : undefined;
    const searchWhere = searchTerm
      ? rankedIds
        ? { id: { in: rankedIds } }
        : this.buildSearchWhere(searchTerm)
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

    const orderBy:
      | Prisma.ProductOrderByWithRelationInput
      | Prisma.ProductOrderByWithRelationInput[] = (() => {
      // Default order: complete cards (photo, description) first, then by
      // name — see ListingRankService.
      if (!filter.sortBy) return [{ listingRank: 'desc' }, { name: 'asc' }];

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

    const computeSummary = async () => {
      const specFacets = await this.buildSpecFacets(
        categoryIds,
        specSelections,
        buildWhere,
      );

      const [total, categoryCounts, brandCounts, price] = await Promise.all([
        this.prisma.product.count({ where }),
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
        /**
         * No `sources` facet on purpose. The «Поставщик» filter is admin-only
         * (which supplier carries what is internal), so counting it cost four
         * semi-joins over `SourceProduct` on every listing — and on every filter
         * change, which Nitro does not cache — to produce numbers nobody but an
         * admin could ever see. The admin facet renders the supplier list from
         * `GET /sources` without counts.
         */
        priceRange:
          price._min.priceValue !== null
            ? {
                min: Math.floor(price._min.priceValue),
                max: Math.ceil(price._max.priceValue ?? price._min.priceValue),
              }
            : null,
        specs: specFacets,
      };
      return { total, facets };
    };

    const [products, { total, facets }] = await Promise.all([
      useRelevance && searchTerm
        ? this.findPageByRelevance(where, rankedIds ?? undefined, skip, limit)
        : this.prisma.product.findMany({
            where,
            skip,
            take: limit,
            orderBy,
            include: LIST_INCLUDE,
          }),
      this.cachedSummary(facetsCacheKey(filter), computeSummary),
    ]);

    const data = products.map((product) => {
      const { _count, ...rest } = product;
      return {
        ...toPublicProduct(rest),
        images: withoutPlaceholderImages(product.images),
        // The card shows the first three — see `publicSpecs`.
        productSpecs: publicSpecs(
          product.productSpecs.map((productSpec) => ({
            name: productSpec.specification.name,
            value: productSpec.value,
          })),
        ),
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
   * Page of products in relevance order. `rankedIds` is every match, best
   * first; the relational `where` narrows it by the other filters. Without
   * the list (a term too broad for it) the page is alphabetical.
   */
  private async findPageByRelevance(
    where: Prisma.ProductWhereInput,
    rankedIds: string[] | undefined,
    skip: number,
    limit: number,
  ): Promise<ListProduct[]> {
    let pageIds: string[];
    if (rankedIds) {
      const position = new Map(rankedIds.map((id, index) => [id, index]));
      const filtered = rankedIds.length
        ? await this.prisma.product.findMany({ where, select: { id: true } })
        : [];
      pageIds = filtered
        .map((row) => row.id)
        .sort(
          (a, b) =>
            (position.get(a) ?? Number.MAX_SAFE_INTEGER) -
            (position.get(b) ?? Number.MAX_SAFE_INTEGER),
        )
        .slice(skip, skip + limit);
    } else {
      pageIds = (
        await this.prisma.product.findMany({
          where,
          select: { id: true },
          orderBy: [{ listingRank: 'desc' }, { name: 'asc' }],
          skip,
          take: limit,
        })
      ).map((row) => row.id);
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
   * The relational form of the match, for a term too broad for the id list
   * (`rankedMatchIds` answered null). Slow on purpose-free terms, but correct:
   * every count covers every match. No typo tolerance here — a one- or
   * two-letter term has nothing to be tolerant about.
   */
  private buildSearchWhere(term: string): Prisma.ProductWhereInput {
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
    const barcode = barcodeTerm(term);
    if (barcode) {
      substring.push(
        { barcode },
        { barcode: { startsWith: `${barcode} ` } },
        { barcode: { contains: `(${barcode})` } },
      );
    }
    return { OR: substring };
  }

  /** filter set → { total, facets }. Insertion order doubles as LRU order. */
  private readonly summaryCache = new Map<
    string,
    { at: number; value: Promise<unknown> }
  >();

  /**
   * Shares one computation of `total` + facets among every request for the
   * same filter set within FACETS_CACHE_TTL_MS — concurrent ones included, so
   * a crawler paging through a category computes them once, not per page.
   */
  private cachedSummary<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.summaryCache.get(key);
    if (hit && now - hit.at < FACETS_CACHE_TTL_MS) {
      this.summaryCache.delete(key);
      this.summaryCache.set(key, hit);
      return hit.value as Promise<T>;
    }
    const value = compute();
    const entry = { at: now, value };
    this.summaryCache.set(key, entry);
    // A failure is not remembered: the next request recomputes.
    value.catch(() => {
      if (this.summaryCache.get(key) === entry) this.summaryCache.delete(key);
    });
    while (this.summaryCache.size > FACETS_CACHE_MAX_ENTRIES) {
      const oldest = this.summaryCache.keys().next().value as string;
      this.summaryCache.delete(oldest);
    }
    return value;
  }

  /** term → ranked ids, for a minute. Insertion order doubles as LRU order. */
  private readonly searchCache = new Map<
    string,
    { at: number; ids: Promise<string[] | null> }
  >();

  /**
   * Every published product a term matches, best first — or null when it
   * matches more than SEARCH_MATCH_LIMIT (the caller falls back to the
   * relational clause). Concurrent and repeated calls for the same term share
   * one query: the listing, its facets and the header suggestions all ask.
   */
  rankedMatchIds(term: string): Promise<string[] | null> {
    const key = term.trim().toLowerCase();
    const now = Date.now();
    const hit = this.searchCache.get(key);
    if (hit && now - hit.at < SEARCH_CACHE_TTL_MS) {
      this.searchCache.delete(key);
      this.searchCache.set(key, hit);
      return hit.ids;
    }
    const ids = this.queryRankedMatchIds(key);
    const entry = { at: now, ids };
    this.searchCache.set(key, entry);
    // Keep only modest lists, and drop a failed query so the next call retries.
    ids.then(
      (result) => {
        if (result && result.length > SEARCH_CACHE_MAX_IDS) {
          if (this.searchCache.get(key) === entry) this.searchCache.delete(key);
        }
      },
      () => {
        if (this.searchCache.get(key) === entry) this.searchCache.delete(key);
      },
    );
    while (this.searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = this.searchCache.keys().next().value as string;
      this.searchCache.delete(oldest);
    }
    return ids;
  }

  /**
   * One query: the match as a `UNION` of index-served branches (trigram GIN
   * on name, sku, model and brand name, the barcode, typo-tolerant `<%`),
   * ranked over the matched rows only — exact/prefix SKU and barcode first,
   * then name prefix, substring, model, brand, and word similarity.
   */
  private async queryRankedMatchIds(term: string): Promise<string[] | null> {
    const variants = searchVariants(term);
    if (!variants.length) return [];
    const barcode = barcodeTerm(term);

    const branches: Prisma.Sql[] = [];
    for (const variant of variants) {
      const like = `%${escapeLike(variant)}%`;
      branches.push(
        Prisma.sql`SELECT "id" FROM "Product" WHERE "name" ILIKE ${like}`,
        Prisma.sql`SELECT "id" FROM "Product" WHERE "sku" ILIKE ${like}`,
        Prisma.sql`SELECT "id" FROM "Product" WHERE "model" ILIKE ${like}`,
        Prisma.sql`SELECT "id" FROM "Product" WHERE "brandId" IN (SELECT "id" FROM "Brand" WHERE "name" ILIKE ${like})`,
      );
      if (variant.length >= MIN_FUZZY_LENGTH) {
        branches.push(
          Prisma.sql`SELECT "id" FROM "Product" WHERE ${variant} <% "name"`,
        );
      }
    }
    // Suppliers store a second code beside the main one as `A (B)`.
    const barcodeHit = barcode
      ? Prisma.sql`(p."barcode" = ${barcode}
          OR p."barcode" LIKE ${`${barcode} %`}
          OR p."barcode" LIKE ${`%(${barcode})%`})`
      : null;
    if (barcode) {
      branches.push(
        Prisma.sql`SELECT "id" FROM "Product" p WHERE ${barcodeHit!}`,
      );
    }

    const rankClauses = variants.map((variant) => {
      const like = `%${escapeLike(variant)}%`;
      const prefix = `${escapeLike(variant)}%`;
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
    if (barcodeHit) {
      rankClauses.push(Prisma.sql`CASE WHEN ${barcodeHit} THEN 100 ELSE 0 END`);
    }

    const rows = await this.withTrigramThreshold<{ id: string }>(
      Prisma.sql`
        WITH matched AS (${Prisma.join(branches, ' UNION ')})
        SELECT p."id"
        FROM "Product" p
        LEFT JOIN "Brand" b ON b."id" = p."brandId"
        WHERE p."status" = 'PUBLISHED' AND p."id" IN (SELECT "id" FROM matched)
        ORDER BY GREATEST(${Prisma.join(rankClauses, ', ')}) DESC, p."listingRank" DESC, p."name" ASC
        LIMIT ${SEARCH_MATCH_LIMIT + 1}
      `,
    );
    if (rows.length > SEARCH_MATCH_LIMIT) return null;
    return rows.map((row) => row.id);
  }

  /**
   * Runs a query with `pg_trgm.word_similarity_threshold` set for this
   * transaction only, so the typo-tolerant match can be written as the
   * `<%` operator. `word_similarity(a, b) > x` is a function call the GIN
   * trigram index on `name` cannot serve — every search was a sequential
   * scan of the catalogue; the operator form is an index lookup.
   *
   * A *batch* transaction, not an interactive one: the interactive kind is
   * cut at 5 s, and under load (a crawler, a parser batch writing products)
   * the search ran past that — ~100 catalogue and suggest requests answered
   * 500 «Transaction already closed» on 27–28.10. A batch is the same single
   * transaction with no client-side timer and no connection held between
   * round trips.
   */
  private async withTrigramThreshold<T>(query: Prisma.Sql): Promise<T[]> {
    const [, rows] = await this.prisma.$transaction([
      this.prisma
        .$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(SIMILARITY_THRESHOLD)}, true)`,
      this.prisma.$queryRaw<T[]>(query),
    ]);
    return rows;
  }

  /** Live header suggestions: top products, categories and brands for a query. */
  async suggest(query: string) {
    // Header autocomplete: capped like `search` so one request cannot carry a
    // page of text into the trigram scan.
    const term = (query?.trim() ?? '').slice(0, 100);
    if (term.length < 2) {
      return { products: [], categories: [], brands: [] };
    }

    const variants = searchVariants(term);
    const nameMatch = {
      OR: variants.map((variant) => ({
        name: { contains: variant, mode: 'insensitive' as const },
      })),
    };

    const ids = ((await this.rankedMatchIds(term)) ?? []).slice(0, 6);
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
    const categories = await this.categoryIndex();

    const childrenByParent = new Map<string, string[]>();
    for (const category of categories) {
      const key = category.parentId ?? '';
      const list = childrenByParent.get(key) ?? [];
      list.push(category.id);
      childrenByParent.set(key, list);
    }
    // The seen-set guards against a parentId cycle (raw SQL edits, an old
    // parser repair), which would otherwise hang the event loop on every
    // catalogue request.
    const descendantsOf = (id: string) => {
      const seen = new Set<string>();
      const queue = [id];
      while (queue.length) {
        const current = queue.shift() as string;
        if (seen.has(current)) continue;
        seen.add(current);
        queue.push(...(childrenByParent.get(current) ?? []));
      }
      return [...seen];
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

  private categoryCache: {
    promise: Promise<CategoryIndexRow[]>;
    expiresAt: number;
  } | null = null;

  /**
   * Every category's id/parent/slug/visibility, shared for a few seconds.
   * Every `/products` call needs it to expand a category filter into its
   * subtree, and filter changes on the storefront are client-side requests
   * Nitro does not cache.
   */
  private categoryIndex(): Promise<CategoryIndexRow[]> {
    const now = Date.now();
    if (this.categoryCache && this.categoryCache.expiresAt > now) {
      return this.categoryCache.promise;
    }
    const promise = this.prisma.category.findMany({
      select: { id: true, parentId: true, slug: true, isVisible: true },
    });
    this.categoryCache = { promise, expiresAt: now + CATEGORY_CACHE_TTL_MS };
    promise.catch(() => {
      if (this.categoryCache?.promise === promise) this.categoryCache = null;
    });
    return promise;
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
