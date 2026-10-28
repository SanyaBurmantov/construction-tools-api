import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PLACEHOLDER_IMAGE_MARKERS } from '../common/utils/product-images';
import { runsBackgroundJobs } from '../common/utils/process-role';

const BOOT_DELAY_MS = 120_000;

/**
 * Keeps `Product.listingRank` (photo 2 + description 1) in step with the
 * catalogue, so the default order shows cards a buyer can judge first and
 * the 3k without a photo or the 7k without a description at the end — also
 * what a search engine's crawler sees first on a category page.
 *
 * One set-based UPDATE that only touches rows whose rank changed: parsers add
 * photos and AI tasks add descriptions all day, so it runs hourly and once
 * after boot. Placeholder images do not count — same markers as
 * `withoutPlaceholderImages`.
 */
@Injectable()
export class ListingRankService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ListingRankService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (!runsBackgroundJobs()) return;
    this.timer = setTimeout(() => void this.refresh(), BOOT_DELAY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearTimeout(this.timer);
  }

  @Cron('0 12 * * * *')
  async refresh(): Promise<number> {
    const notPlaceholder = Prisma.join(
      PLACEHOLDER_IMAGE_MARKERS.map(
        (marker) => Prisma.sql`lower(i."url") NOT LIKE ${`%${marker}%`}`,
      ),
      ' AND ',
    );
    try {
      const changed = await this.prisma.$executeRaw`
        UPDATE "Product" p SET "listingRank" = r.rank
        FROM (
          SELECT p2."id",
            (CASE WHEN EXISTS (
               SELECT 1 FROM "ProductImage" i
               WHERE i."productId" = p2."id" AND ${notPlaceholder}
             ) THEN 2 ELSE 0 END)
            + (CASE WHEN coalesce(p2."descriptionFull", '') <> ''
                      OR coalesce(p2."descriptionShort", '') <> ''
                    THEN 1 ELSE 0 END) AS rank
          FROM "Product" p2
        ) r
        WHERE p."id" = r."id" AND p."listingRank" <> r.rank`;
      if (changed)
        this.logger.log(`Listing rank updated for ${changed} products`);
      return changed;
    } catch (error) {
      this.logger.error(
        `Listing rank refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
