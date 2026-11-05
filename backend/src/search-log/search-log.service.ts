import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { SearchEventDto } from './search-log.dto';
import { normalizeSearchTerm } from './search-term';

/** The same search from the same visitor within this window counts once. */
const REPEAT_WINDOW_MS = 10 * 60_000;
const DEFAULT_TTL_DAYS = 365;

/**
 * The search journal: what visitors look for, what finds nothing, what they
 * click. The point is the «ничего не найдено» list — each line is a product,
 * a synonym or a word form the catalogue is missing — and the click rate,
 * which says whether the results are any good. Never fails the visitor:
 * a write that does not happen is logged and forgotten.
 */
@Injectable()
export class SearchLogService {
  private readonly logger = new Logger(SearchLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(dto: SearchEventDto, ip?: string): Promise<void> {
    const term = normalizeSearchTerm(dto.term);
    if (!term) return;
    const ipHash = hashIp(ip);
    try {
      if (dto.kind === 'SEARCH' && ipHash) {
        const repeat = await this.prisma.searchEvent.findFirst({
          where: {
            kind: 'SEARCH',
            term,
            source: dto.source,
            ipHash,
            createdAt: { gte: new Date(Date.now() - REPEAT_WINDOW_MS) },
          },
          select: { id: true },
        });
        if (repeat) return;
      }
      await this.prisma.searchEvent.create({
        data: {
          kind: dto.kind,
          term,
          source: dto.source,
          results: dto.kind === 'SEARCH' ? (dto.results ?? null) : null,
          productId: dto.kind === 'CLICK' ? (dto.productId ?? null) : null,
          position: dto.kind === 'CLICK' ? (dto.position ?? null) : null,
          ipHash,
        },
      });
    } catch (error) {
      this.logger.warn(`Search event not saved: ${String(error)}`);
    }
  }

  /**
   * The admin report over the last `days`: totals, the most frequent
   * searches with their click rate, the ones that found nothing, and the
   * latest events.
   */
  private popularCache: { at: number; terms: Promise<string[]> } | null = null;

  /**
   * What people search for, for «Популярное:» under the home page search:
   * terms with results that at least two different visitors used in 30 days,
   * most visitors first. Cached an hour; empty until the journal has some.
   */
  popularTerms(limit = 4): Promise<string[]> {
    const hit = this.popularCache;
    if (hit && Date.now() - hit.at < 60 * 60_000) return hit.terms;
    const terms = this.prisma.$queryRaw<Array<{ term: string }>>`
        SELECT term FROM "SearchEvent"
        WHERE kind = 'SEARCH' AND results > 0
          AND "createdAt" > now() - interval '30 days'
          AND length(term) BETWEEN 3 AND 40
        GROUP BY term
        HAVING count(DISTINCT COALESCE("ipHash", id)) >= 2
        ORDER BY count(DISTINCT COALESCE("ipHash", id)) DESC, term
        LIMIT ${limit}`
      .then((rows) => rows.map((row) => row.term))
      .catch(() => {
        this.popularCache = null;
        return [] as string[];
      });
    this.popularCache = { at: Date.now(), terms };
    return terms;
  }

  async report(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const [totals] = await this.prisma.$queryRaw<
      Array<{
        searches: bigint;
        terms: bigint;
        zero: bigint;
        clicks: bigint;
        searchers: bigint;
      }>
    >`
      SELECT
        count(*) FILTER (WHERE kind = 'SEARCH') AS searches,
        count(DISTINCT term) FILTER (WHERE kind = 'SEARCH') AS terms,
        count(*) FILTER (WHERE kind = 'SEARCH' AND results = 0) AS zero,
        count(*) FILTER (WHERE kind = 'CLICK') AS clicks,
        count(DISTINCT "ipHash") AS searchers
      FROM "SearchEvent" WHERE "createdAt" >= ${since}`;

    const top = await this.prisma.$queryRaw<
      Array<{
        term: string;
        searches: bigint;
        results: number | null;
        clicks: bigint;
        last_at: Date;
      }>
    >`
      SELECT term,
             count(*) FILTER (WHERE kind = 'SEARCH') AS searches,
             (array_agg(results ORDER BY "createdAt" DESC) FILTER (WHERE kind = 'SEARCH'))[1] AS results,
             count(*) FILTER (WHERE kind = 'CLICK') AS clicks,
             max("createdAt") AS last_at
      FROM "SearchEvent" WHERE "createdAt" >= ${since}
      GROUP BY term
      HAVING count(*) FILTER (WHERE kind = 'SEARCH') > 0
      ORDER BY 2 DESC, last_at DESC
      LIMIT 100`;

    const zero = await this.prisma.$queryRaw<
      Array<{ term: string; searches: bigint; last_at: Date }>
    >`
      SELECT term, count(*) AS searches, max("createdAt") AS last_at
      FROM "SearchEvent"
      WHERE "createdAt" >= ${since} AND kind = 'SEARCH' AND results = 0
      GROUP BY term
      ORDER BY 2 DESC, 3 DESC
      LIMIT 100`;

    const recent = await this.prisma.searchEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        kind: true,
        term: true,
        results: true,
        position: true,
        source: true,
        createdAt: true,
        productId: true,
      },
    });
    const productIds = [
      ...new Set(recent.map((e) => e.productId).filter(Boolean)),
    ] as string[];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const searches = Number(totals?.searches ?? 0);
    return {
      days,
      since,
      totals: {
        searches,
        terms: Number(totals?.terms ?? 0),
        zero: Number(totals?.zero ?? 0),
        zeroShare: searches ? Number(totals.zero) / searches : null,
        clicks: Number(totals?.clicks ?? 0),
        clickRate: searches ? Number(totals.clicks) / searches : null,
        searchers: Number(totals?.searchers ?? 0),
      },
      top: top.map((row) => ({
        term: row.term,
        searches: Number(row.searches),
        results: row.results,
        clicks: Number(row.clicks),
        clickRate: Number(row.searches)
          ? Number(row.clicks) / Number(row.searches)
          : null,
        lastAt: row.last_at,
      })),
      zero: zero.map((row) => ({
        term: row.term,
        searches: Number(row.searches),
        lastAt: row.last_at,
      })),
      recent: recent.map(({ productId, ...event }) => ({
        ...event,
        product: productId ? (productById.get(productId) ?? null) : null,
      })),
    };
  }

  /** Nightly: the journal keeps `SEARCH_LOG_TTL_DAYS` (365). */
  async purgeOld() {
    const days = Number(process.env.SEARCH_LOG_TTL_DAYS) || DEFAULT_TTL_DAYS;
    const { count } = await this.prisma.searchEvent.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } },
    });
    if (count) this.logger.log(`Search journal: ${count} old events removed`);
    return count;
  }
}

/** Same salted hash as reviews and leads: counts repeats, recovers nothing. */
function hashIp(ip?: string): string | null {
  if (!ip) return null;
  const salt = process.env.REVIEW_IP_SALT || process.env.ADMIN_TOKEN || '';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}
