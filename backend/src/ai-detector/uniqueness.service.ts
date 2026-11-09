import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { competitorQuery, type CompetitorQuery } from './competitors';
import { CompetitorsService } from './competitors.service';
import { ourHosts } from './our-hosts';
import { fetchReadablePage } from './page-fetch';
import { searchQueries, uniqueness, type UniquenessSource } from './uniqueness';
import {
  PRODUCT_DESCRIPTION_DOC_SQL,
  SOURCE_DESCRIPTION_DOC_SQL,
} from './uniqueness-sql';

export const MAX_COMPARE_URLS = 5;

/** Word runs the indexes are asked for, spread over the text. */
const SEARCH_QUERIES = 12;
/** Rows one run may bring: a supplier's template phrase sits in thousands. */
const ROWS_PER_QUERY = 300;
/** Candidates whose texts are read and shingled, most runs matched first. */
const CATALOGUE_HITS = 25;
const SUPPLIER_HITS = 15;
/** Index lookups take milliseconds; this only guards a pathological text. */
const SEARCH_TIMEOUT_MS = 8_000;
const SIBLINGS = 15;
const SOURCE_TEXT_CHARS = 20_000;

const PRODUCT_DOC = Prisma.raw(PRODUCT_DESCRIPTION_DOC_SQL);
const SOURCE_DOC = Prisma.raw(SOURCE_DESCRIPTION_DOC_SQL);

export type UniquenessKind =
  | 'supplier'
  | 'sibling'
  | 'catalogue'
  | 'competitor'
  | 'page';

export type UniquenessMatch = {
  kind: UniquenessKind;
  title: string;
  /** Our product page path, or an external address. */
  url: string | null;
  /** Supplier's name: admin-only, dropped for the SEO role. */
  supplier?: string;
  share: number;
};

export type UniquenessReport = {
  percent: number | null;
  contentWords: number;
  matches: UniquenessMatch[];
  spans: Array<{ start: number; end: number; sources: number[] }>;
  /** What was compared — the answer is only as wide as this. */
  scope: string[];
  warnings: string[];
};

type Meta = Omit<UniquenessMatch, 'share'>;
type ProductText = {
  id: string;
  slug: string;
  name: string;
  full: string | null;
  short: string | null;
};
type OwnProduct = ProductText & { categoryId: string; brand: string | null };

/**
 * «Уникальность»: how much of a text already exists in our catalogue, in the
 * suppliers' texts of the same product, among its siblings and on pages a
 * person names. Free — no search engine; the internet-wide check is a
 * separate, later step. A seller of other people's goods mostly competes with
 * the supplier's own text, which every reseller copies, and with near-copies
 * across a product line — both are answered here.
 */
@Injectable()
export class UniquenessService {
  private readonly logger = new Logger(UniquenessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly competitors: CompetitorsService,
  ) {}

  /**
   * `productName` names the product for the competitors' search when the
   * text was pasted; our own product page names itself, and an outside page
   * is searched by its title.
   */
  async check(
    text: string,
    options: {
      url?: string | null;
      compareUrls?: string[];
      productName?: string | null;
      pageTitle?: string | null;
    } = {},
  ): Promise<UniquenessReport> {
    const warnings: string[] = [];
    const scope: string[] = [];
    const sources: Array<UniquenessSource<Meta>> = [];
    const seenProducts = new Set<string>();
    const seenOffers = new Set<string>();

    const own = options.url ? await this.ourProduct(options.url) : null;
    if (own) {
      seenProducts.add(own.id);
      const offers = await this.supplierTexts(own.id);
      for (const offer of offers) {
        seenOffers.add(offer.id);
        sources.push(supplierSource(offer));
      }
      scope.push(
        offers.length
          ? `текст поставщика этого товара (${offers.length})`
          : 'текста поставщика у товара нет',
      );
      const siblings = await this.siblings(own);
      for (const p of siblings) {
        seenProducts.add(p.id);
        sources.push(productSource(p, 'sibling'));
      }
      scope.push(`похожие товары той же категории (${siblings.length})`);
    }

    const query = this.competitorQueryFor(options, own);
    const queries = searchQueries(text, SEARCH_QUERIES);
    const [catalogue, rivals, pages] = await Promise.all([
      queries.length
        ? this.indexHits(queries, [...seenProducts], [...seenOffers]).catch(
            (error: Error) => {
              this.logger.warn(`catalogue search failed: ${error.message}`);
              return null;
            },
          )
        : Promise.resolve({ products: [], offers: [] }),
      query ? this.competitors.search(query) : Promise.resolve(null),
      Promise.all(
        (options.compareUrls ?? []).slice(0, MAX_COMPARE_URLS).map((url) =>
          fetchReadablePage(url, { whole: true }).then(
            (page) => ({ url, page }),
            (error: Error) => ({ url, error }),
          ),
        ),
      ),
    ]);

    if (catalogue) {
      for (const p of catalogue.products)
        sources.push(productSource(p, 'catalogue'));
      for (const o of catalogue.offers) sources.push(supplierSource(o));
      scope.push('весь наш каталог и тексты поставщиков');
    } else if (queries.length) {
      warnings.push('Поиск по каталогу не успел — проверено без него.');
    }

    if (rivals) {
      for (const page of rivals.pages) {
        sources.push({
          text: page.text,
          meta: {
            kind: 'competitor',
            title: `${page.competitor}: ${page.title ?? page.url}`,
            url: page.url,
          },
        });
      }
      scope.push(
        `конкуренты по запросу «${query!.query}» — ${rivals.notes.join(', ')}`,
      );
      warnings.push(...rivals.warnings);
    } else {
      scope.push(
        'у конкурентов не искали: укажите название товара или проверяйте ссылку на карточку',
      );
    }

    for (const result of pages) {
      if ('error' in result) {
        warnings.push(`${result.url}: ${result.error.message}`);
        continue;
      }
      sources.push({
        text: result.page.text,
        meta: {
          kind: 'page',
          title: result.page.title || result.url,
          url: result.url,
        },
      });
      scope.push(`страница ${hostOf(result.url)}`);
    }

    const result = uniqueness(text, sources);
    if (result.percent === null) {
      warnings.push('Текст слишком короткий, чтобы считать уникальность.');
    }
    return {
      percent: result.percent,
      contentWords: result.contentWords,
      matches: result.sources,
      spans: result.spans,
      scope,
      warnings,
    };
  }

  private competitorQueryFor(
    options: {
      url?: string | null;
      productName?: string | null;
      pageTitle?: string | null;
    },
    own: OwnProduct | null,
  ): CompetitorQuery | null {
    const typed = options.productName?.trim();
    if (typed) return competitorQuery(typed);
    if (own) return competitorQuery(own.name, own.brand);
    // An outside page (a supplier's or someone's card) — by its title, minus
    // the site name after a separator.
    const title = options.pageTitle?.split(/\s+[|—–-]\s+/)[0]?.trim();
    return options.url && title ? competitorQuery(title) : null;
  }

  /** The product behind one of our own `/product/<slug>` addresses. */
  private async ourProduct(raw: string): Promise<OwnProduct | null> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!ourHosts().has(url.hostname.toLowerCase())) return null;
    const slug = /^\/product\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    if (!slug) return null;
    const decoded = decodeURIComponent(slug).toLowerCase();
    const redirect = await this.prisma.productRedirect.findUnique({
      where: { slug: decoded },
      select: { productId: true },
    });
    const rows = await this.prisma.$queryRaw<OwnProduct[]>`
      SELECT p.id, p.slug, p.name, p."categoryId", b.name AS brand,
             left(p."descriptionFull", ${SOURCE_TEXT_CHARS}::int) AS "full",
             left(p."descriptionShort", ${SOURCE_TEXT_CHARS}::int) AS "short"
      FROM "Product" p LEFT JOIN "Brand" b ON b.id = p."brandId"
      WHERE ${redirect ? Prisma.sql`p.id = ${redirect.productId}` : Prisma.sql`p.slug = ${decoded}`}
      LIMIT 1`;
    return rows[0] ?? null;
  }

  private supplierTexts(productId: string) {
    return this.prisma.$queryRaw<OfferText[]>`
      SELECT sp.id, sp.name, sp.url, s.name AS source,
             left(sp.description, ${SOURCE_TEXT_CHARS}::int) AS description
      FROM "SourceProduct" sp JOIN "Source" s ON s.id = sp."sourceId"
      WHERE sp."productId" = ${productId}
      ORDER BY sp."createdAt"`;
  }

  /** Same category, similar name — a product line written from one template. */
  private async siblings(own: OwnProduct) {
    const product = own;
    if (!own.categoryId) return [];
    return this.prisma.$queryRaw<ProductText[]>`
      SELECT id, slug, name,
             left("descriptionFull", ${SOURCE_TEXT_CHARS}::int) AS "full",
             left("descriptionShort", ${SOURCE_TEXT_CHARS}::int) AS "short"
      FROM "Product"
      WHERE "categoryId" = ${own.categoryId} AND id <> ${product.id}
        AND status = 'PUBLISHED' AND similarity(name, ${product.name}) > 0.3
      ORDER BY similarity(name, ${product.name}) DESC
      LIMIT ${SIBLINGS}::int`;
  }

  /**
   * Products and supplier offers whose descriptions hold most of the word
   * runs, through the full-text indexes (`uniqueness-sql.ts`). A run matches
   * when all its words occur in the first 4000 characters, in any form and
   * order — a loose net on purpose: the shingles decide what is a copy.
   * Without phrase operators GIN answers exactly (no recheck), so a run is
   * milliseconds even when thousands of rows hold it.
   */
  private indexHits(
    queries: string[],
    excludeProducts: string[],
    excludeOffers: string[],
  ) {
    const runs = (table: 'Product' | 'SourceProduct') =>
      Prisma.join(
        queries.map((q, i) =>
          table === 'Product'
            ? Prisma.sql`(SELECT id, ${i}::int AS run FROM "Product" WHERE ${PRODUCT_DOC} @@ plainto_tsquery('russian', ${q}) AND status = 'PUBLISHED' LIMIT ${ROWS_PER_QUERY}::int)`
            : Prisma.sql`(SELECT id, ${i}::int AS run FROM "SourceProduct" WHERE ${SOURCE_DOC} @@ plainto_tsquery('russian', ${q}) LIMIT ${ROWS_PER_QUERY}::int)`,
        ),
        ' UNION ALL ',
      );
    const notIn = (ids: string[]) =>
      ids.length
        ? Prisma.sql`WHERE id NOT IN (${Prisma.join(ids)})`
        : Prisma.empty;
    // One hit is a shared turn of phrase; two runs out of a short text is enough.
    const minRuns = Math.min(2, queries.length);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL statement_timeout = ${SEARCH_TIMEOUT_MS}`,
        );
        const products = await tx.$queryRaw<ProductText[]>`
          WITH hits AS (
            SELECT id, count(DISTINCT run) AS n FROM (${runs('Product')}) r
            ${notIn(excludeProducts)}
            GROUP BY id HAVING count(DISTINCT run) >= ${minRuns}::int
            ORDER BY n DESC LIMIT ${CATALOGUE_HITS}::int
          )
          SELECT p.id, p.slug, p.name,
                 left(p."descriptionFull", ${SOURCE_TEXT_CHARS}::int) AS "full",
                 left(p."descriptionShort", ${SOURCE_TEXT_CHARS}::int) AS "short"
          FROM hits JOIN "Product" p ON p.id = hits.id
          ORDER BY hits.n DESC`;
        const offers = await tx.$queryRaw<OfferText[]>`
          WITH hits AS (
            SELECT id, count(DISTINCT run) AS n FROM (${runs('SourceProduct')}) r
            ${notIn(excludeOffers)}
            GROUP BY id HAVING count(DISTINCT run) >= ${minRuns}::int
            ORDER BY n DESC LIMIT ${SUPPLIER_HITS}::int
          )
          SELECT sp.id, sp.name, sp.url, s.name AS source,
                 left(sp.description, ${SOURCE_TEXT_CHARS}::int) AS description
          FROM hits JOIN "SourceProduct" sp ON sp.id = hits.id
          JOIN "Source" s ON s.id = sp."sourceId"
          ORDER BY hits.n DESC`;
        return { products, offers };
      },
      // Prisma's default 5 s would close the transaction under a slow query.
      { timeout: SEARCH_TIMEOUT_MS + 3_000, maxWait: 5_000 },
    );
  }
}

type OfferText = {
  id: string;
  name: string;
  url: string;
  description: string | null;
  source: string;
};

function supplierSource(offer: OfferText): UniquenessSource<Meta> {
  return {
    text: `${offer.name}\n${offer.description ?? ''}`,
    meta: {
      kind: 'supplier',
      title: `Текст поставщика: ${offer.name}`,
      url: offer.url,
      supplier: offer.source,
    },
  };
}

function productSource(
  p: ProductText,
  kind: 'sibling' | 'catalogue',
): UniquenessSource<Meta> {
  return {
    text: [p.short, p.full].filter(Boolean).join('\n'),
    meta: { kind, title: p.name, url: `/product/${p.slug}` },
  };
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** What the SEO role may see: the supplier stays internal (as everywhere else). */
export function uniquenessForSeo(report: UniquenessReport): UniquenessReport {
  return {
    ...report,
    scope: report.scope,
    matches: report.matches.map((m) =>
      m.kind === 'supplier'
        ? { kind: m.kind, title: 'Текст поставщика', url: null, share: m.share }
        : m,
    ),
  };
}
