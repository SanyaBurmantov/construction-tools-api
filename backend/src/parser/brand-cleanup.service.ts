import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { isRealBrandName } from './brand-name';

/** Wait for the app to settle (migrations, crons) before scanning. */
const BOOT_DELAY_MS = 90_000;

export type BrandCleanupReport = {
  /** Brand rows whose name is not a brand (see `brand-name.ts`). */
  bogusBrands: number;
  /** Products whose `brandId` was cleared. */
  productsDetached: number;
  /** Bogus brand rows deleted. */
  brandsDeleted: number;
  /** Bogus rows kept because a pricing rule points at them — an admin's call. */
  keptForPricingRules: string[];
};

/**
 * Removes the `Brand` rows imported before `upsertBrand()` started refusing
 * values that are not brands — «запчасти» (712 products), «Запчасти М-7»,
 * «без товарного знака», «Измерители»…
 *
 * The products stay; they just lose the bogus brand (`brandId = null`), which
 * is what a re-parse would give them now. The brand row is then deleted, so
 * its landing page and its tile in `/brand` go away. A row a pricing rule is
 * attached to is left alone and reported: deleting it would silently change
 * prices, which is not a cleanup's business.
 *
 * Runs once per boot (like `ProductTextCleanupService`), every night at 04:17
 * so a value that slipped past the import check is gone by morning
 * without anyone pressing a button, and on demand from
 * `POST /admin/parser/clean-brands`. Idempotent: on a clean catalogue it
 * reads the brand list and writes nothing. Set `BRAND_CLEANUP_ON_BOOT=false`
 * to skip the boot pass.
 */
@Injectable()
export class BrandCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BrandCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (process.env.BRAND_CLEANUP_ON_BOOT === 'false') return;
    this.timer = setTimeout(() => {
      this.run().catch((error: unknown) =>
        this.logger.error(
          `Brand cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, BOOT_DELAY_MS);
    this.timer.unref();
  }

  // :17 — clear of every parser slot (see CatalogNormalizerCron).
  @Cron('0 17 4 * * *')
  async nightly() {
    await this.run().catch((error: unknown) =>
      this.logger.error(
        `Nightly brand cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearTimeout(this.timer);
  }

  async run(): Promise<BrandCleanupReport> {
    const brands = await this.prisma.brand.findMany({
      select: {
        id: true,
        name: true,
        _count: { select: { pricingRules: true } },
      },
    });
    const bogus = brands.filter((brand) => !isRealBrandName(brand.name));

    const report: BrandCleanupReport = {
      bogusBrands: bogus.length,
      productsDetached: 0,
      brandsDeleted: 0,
      keptForPricingRules: [],
    };

    for (const brand of bogus) {
      const detached = await this.prisma.product.updateMany({
        where: { brandId: brand.id },
        data: { brandId: null },
      });
      report.productsDetached += detached.count;

      if (brand._count.pricingRules > 0) {
        report.keptForPricingRules.push(brand.name);
        continue;
      }
      await this.prisma.brand.delete({ where: { id: brand.id } });
      report.brandsDeleted++;
    }

    if (bogus.length) {
      this.logger.log(
        `Removed ${report.brandsDeleted} non-brand rows («${bogus
          .slice(0, 5)
          .map((brand) => brand.name)
          .join('», «')}»…), detached ${report.productsDetached} products`,
      );
    }
    if (report.keptForPricingRules.length) {
      this.logger.warn(
        `Kept non-brand rows referenced by pricing rules: ${report.keptForPricingRules.join(', ')}`,
      );
    }
    return report;
  }
}
