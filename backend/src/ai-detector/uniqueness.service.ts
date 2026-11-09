import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { fetchReadablePage } from './page-fetch';
import {
  containsPattern,
  searchPhrases,
  uniqueness,
  type UniquenessSource,
} from './uniqueness';

export const MAX_COMPARE_URLS = 5;

/** How many phrases the catalogue is searched by: each costs ~0.6 s of one core. */
const SEARCH_PHRASES = 4;
/** Only this much of each stored text is searched (a copy starts early). */
const SEARCH_PREFIX_CHARS = 6000;
const SEARCH_TIMEOUT = '10s';
const CATALOGUE_HITS = 20;
const SIBLINGS = 15;
const SOURCE_TEXT_CHARS = 20_000;

export type UniquenessKind = 'supplier' | 'sibling' | 'catalogue' | 'page';

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

  constructor(private readonly prisma: PrismaService) {}

  async check(
    text: string,
    options: { url?: string | null; compareUrls?: string[] } = {},
  ): Promise<UniquenessReport> {
    const warnings: string[] = [];
    const scope: string[] = [];
    const sources: Array<UniquenessSource<Meta>> = [];
    const seen = new Set<string>();

    const own = options.url ? await this.ourProduct(options.url) : null;
    if (own) {
      seen.add(own.id);
      const offers = await this.supplierTexts(own.id);
      for (const offer of offers) {
        sources.push({
          text: `${offer.name}\n${offer.description ?? ''}`,
          meta: {
            kind: 'supplier',
            title: `Текст поставщика: ${offer.name}`,
            url: offer.url,
            supplier: offer.source,
          },
        });
      }
      scope.push(
        offers.length
          ? `текст поставщика этого товара (${offers.length})`
          : 'текста поставщика у товара нет',
      );
      const siblings = await this.siblings(own);
      for (const p of siblings) {
        seen.add(p.id);
        sources.push(productSource(p, 'sibling'));
      }
      scope.push(`похожие товары той же категории (${siblings.length})`);
    }

    const phrases = searchPhrases(text, SEARCH_PHRASES);
    if (phrases.length) {
      try {
        const hits = await this.catalogueHits(phrases, [...seen]);
        for (const p of hits) {
          seen.add(p.id);
          sources.push(productSource(p, 'catalogue'));
        }
        scope.push('весь наш каталог (по дословным фразам)');
      } catch (error) {
        this.logger.warn(
          `catalogue search failed: ${(error as Error).message}`,
        );
        warnings.push('Поиск по каталогу не успел — проверено без него.');
      }
    }

    for (const url of (options.compareUrls ?? []).slice(0, MAX_COMPARE_URLS)) {
      try {
        const page = await fetchReadablePage(url);
        sources.push({
          text: page.text,
          meta: { kind: 'page', title: page.title || url, url },
        });
        scope.push(`страница ${hostOf(url)}`);
      } catch (error) {
        warnings.push(`${url}: ${(error as Error).message}`);
      }
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

  /** The product behind one of our own `/product/<slug>` addresses. */
  private async ourProduct(raw: string): Promise<ProductText | null> {
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
    const rows = await this.prisma.$queryRaw<
      Array<ProductText & { categoryId: string }>
    >`
      SELECT id, slug, name, "categoryId",
             left("descriptionFull", ${SOURCE_TEXT_CHARS}::int) AS "full",
             left("descriptionShort", ${SOURCE_TEXT_CHARS}::int) AS "short"
      FROM "Product"
      WHERE ${redirect ? Prisma.sql`id = ${redirect.productId}` : Prisma.sql`slug = ${decoded}`}
      LIMIT 1`;
    return rows[0] ?? null;
  }

  private supplierTexts(productId: string) {
    return this.prisma.$queryRaw<
      Array<{
        name: string;
        url: string;
        description: string | null;
        source: string;
      }>
    >`
      SELECT sp.name, sp.url, s.name AS source,
             left(sp.description, ${SOURCE_TEXT_CHARS}::int) AS description
      FROM "SourceProduct" sp JOIN "Source" s ON s.id = sp."sourceId"
      WHERE sp."productId" = ${productId}
      ORDER BY sp."createdAt"`;
  }

  /** Same category, similar name — a product line written from one template. */
  private async siblings(product: ProductText) {
    const own = product as ProductText & { categoryId?: string };
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
   * Products whose texts contain one of the phrases verbatim. Case-sensitive
   * `LIKE` on purpose: `ILIKE` on Cyrillic measured 8 s against 4 s on prod
   * (104k descriptions, no index can serve `%…%` cheaply), and a copy keeps
   * the case it was written in. Bounded by a statement timeout.
   */
  private catalogueHits(phrases: string[], exclude: string[]) {
    const patterns = phrases.map(containsPattern);
    const notIn = exclude.length
      ? Prisma.sql`AND id NOT IN (${Prisma.join(exclude)})`
      : Prisma.empty;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL statement_timeout = '${SEARCH_TIMEOUT}'`,
      );
      return tx.$queryRaw<ProductText[]>`
        SELECT id, slug, name,
               left("descriptionFull", ${SOURCE_TEXT_CHARS}::int) AS "full",
               left("descriptionShort", ${SOURCE_TEXT_CHARS}::int) AS "short"
        FROM "Product"
        WHERE status = 'PUBLISHED' ${notIn}
          AND (left("descriptionFull", ${SEARCH_PREFIX_CHARS}::int) LIKE ANY(${patterns})
            OR left("descriptionShort", ${SEARCH_PREFIX_CHARS}::int) LIKE ANY(${patterns}))
        LIMIT ${CATALOGUE_HITS}::int`;
    });
  }
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

/** Our storefront's hosts: gost.by and whatever PUBLIC_ORIGIN names. */
function ourHosts() {
  const hosts = new Set(['gost.by', 'www.gost.by']);
  for (const origin of [process.env.PUBLIC_ORIGIN, process.env.CORS_ORIGIN]) {
    for (const part of (origin ?? '').split(',')) {
      try {
        hosts.add(new URL(part.trim()).hostname.toLowerCase());
      } catch {
        /* not a URL */
      }
    }
  }
  return hosts;
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
