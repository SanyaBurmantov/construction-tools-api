import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RecommendationsService,
  SIMILAR_RULE_VERSION,
  SIMILAR_TTL_MS,
} from './recommendations.service';

/** Products per tick; each is ~0.1 s of DB plus the scoring. */
export const SIMILAR_BATCH = 40;

/**
 * Computes «Похожие» ahead, in the worker (`@Interval` is inert in the API),
 * so a product page reads a stored row instead of ranking 48 candidates per
 * view. On production that ranking was the costliest query of the product
 * page — 23.5k calls, ~1100 s of database time in a day, mostly crawlers on
 * cold pages.
 *
 * Each tick takes the products whose row is missing, of an old rule
 * version, older than SIMILAR_TTL_MS or older than the product's last text
 * change — missing first, then the stalest — one at a time. The first pass
 * over ~85k products takes most of a day; a product page that comes first
 * computes its own row and stores it (RecommendationsService).
 */
@Injectable()
export class SimilarRefreshService {
  private readonly logger = new Logger(SimilarRefreshService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendations: RecommendationsService,
  ) {}

  @Interval(30_000)
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let done = 0;
    try {
      const stale = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT p."id" FROM "Product" p
        LEFT JOIN "ProductSimilar" s ON s."productId" = p."id"
        WHERE p."status" = 'PUBLISHED'
          AND (s."productId" IS NULL
            OR s."ruleVersion" <> ${SIMILAR_RULE_VERSION}
            OR s."computedAt" < ${new Date(Date.now() - SIMILAR_TTL_MS)}
            OR s."computedAt" < p."contentUpdatedAt")
        ORDER BY s."computedAt" ASC NULLS FIRST, p."listingRank" DESC, p."id"
        LIMIT ${SIMILAR_BATCH}`;
      for (const { id } of stale) {
        try {
          if (await this.recommendations.refreshSimilar(id)) done += 1;
        } catch (error) {
          this.logger.warn(
            `«Похожие» for ${id} not refreshed: ${String(error)}`,
          );
        }
      }
      // Rows of products no longer on sale: their page is gone.
      await this.prisma.$executeRaw(Prisma.sql`
        DELETE FROM "ProductSimilar" s USING "Product" p
        WHERE p."id" = s."productId" AND p."status" <> 'PUBLISHED'`);
    } catch (error) {
      this.logger.error(`«Похожие» refresh failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
    return done;
  }
}
