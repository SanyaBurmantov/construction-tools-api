import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { cleanProductTexts } from './supplier-text';

/** Rows per round trip; keeps memory flat on the 1.8 GB box. */
const CHUNK = 500;

/** Wait for the app to settle (migrations, crons) before scanning. */
const BOOT_DELAY_MS = 60_000;

/**
 * Cleans product text imported **before** the parsers sanitized it (see
 * supplier-text.ts): dukon's «Купить … в Минске … ☎ +375 (29) 668-00-11».
 *
 * Why a boot-time pass rather than a SQL migration or a read-time filter:
 * - a migration would need the sanitizer rewritten as Postgres regexes — two
 *   copies of the same rules, one of them untested;
 * - read-time cleaning has to be repeated in every projection that returns
 *   product text (listing, card, search, sitemap, admin) and still leaves the
 *   dirty row for the next one to forget;
 * - this reuses the tested function, runs on deploy with nobody remembering to
 *   press a button, and is idempotent — once the rows are clean the prefilter
 *   matches only text that legitimately says «в Минске», which is read and left
 *   alone. Re-parses keep things clean afterwards through ProductIdentityService.
 *
 * Fire-and-forget with its own catch: a failure here is logged, never fatal.
 */
@Injectable()
export class ProductTextCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ProductTextCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (process.env.PRODUCT_TEXT_CLEANUP_ON_BOOT === 'false') return;
    this.timer = setTimeout(() => {
      this.run().catch((error: unknown) =>
        this.logger.error(
          `Product text cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, BOOT_DELAY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Returns how many products were rewritten. */
  async run(): Promise<{ scanned: number; updated: number }> {
    let scanned = 0;
    let updated = 0;
    let afterId = '';

    for (;;) {
      // Same markers as supplier-text.ts's gate, spelled for Postgres. Both
      // cases are listed because ~* does not fold Cyrillic under a C locale.
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          descriptionShort: string | null;
          descriptionFull: string | null;
          seoTitle: string | null;
          seoDescription: string | null;
        }>
      >`
        SELECT id, name, "descriptionShort", "descriptionFull", "seoTitle", "seoDescription"
        FROM "Product"
        WHERE id > ${afterId}
          AND concat_ws(' ', "descriptionShort", "descriptionFull", "seoTitle", "seoDescription")
              ~ '☎|➢|\\+ ?375|[Зз]воните|[Лл]учшие цены|с гарантией и доставкой|[Мм]инске|[Мм]ниске'
        ORDER BY id
        LIMIT ${CHUNK}
      `;
      if (!rows.length) break;
      scanned += rows.length;
      afterId = rows[rows.length - 1].id;

      for (const row of rows) {
        const patch = cleanProductTexts(row);
        if (!Object.keys(patch).length) continue;
        await this.prisma.product.update({
          where: { id: row.id },
          data: patch,
        });
        updated++;
      }
    }

    if (updated)
      this.logger.log(
        `Removed supplier boilerplate from ${updated} of ${scanned} matching products`,
      );
    return { scanned, updated };
  }
}
