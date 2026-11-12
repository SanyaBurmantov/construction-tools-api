import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  SUPPLIER_TEXT_RULE_VERSION,
  cleanProductTexts,
  type ProductTextFields,
} from './supplier-text';
import { runsBackgroundJobs } from '../common/utils/process-role';

/** Ids per round trip; the texts themselves are read one product at a time. */
const CHUNK = 500;

/** Wait for the app to settle (migrations, crons) before scanning. */
const BOOT_DELAY_MS = 60_000;

/**
 * Where the pass got to under the current rules: the last product id done,
 * or `DONE`. A new rule version is a new key, so the pass starts over.
 */
export const TEXT_CLEANUP_CURSOR_KEY = `productTextCleanup.cursor.v${SUPPLIER_TEXT_RULE_VERSION}`;
const DONE = 'done';

const TEXT_FIELDS = [
  'descriptionShort',
  'descriptionFull',
  'seoTitle',
  'seoDescription',
] as const;

export type TextCleanupReport = {
  scanned: number;
  updated: number;
  /** The pass had already run under these rules: nothing was read. */
  alreadyDone?: boolean;
};

/**
 * Brings product text saved **before** a rule of supplier-text.ts existed up
 * to the current rules: dukon's «Купить … в Минске … ☎ +375 (29) 668-00-11»,
 * the var_dump, tab labels, the description repeated once per trade offer.
 *
 * Why a background pass rather than a SQL migration or a read-time filter:
 * - a migration would need the sanitizer rewritten as Postgres regexes — two
 *   copies of the same rules, one of them untested (and a repeated block is
 *   not something a regex prefilter finds cheaply);
 * - read-time cleaning has to be repeated in every projection that returns
 *   product text (listing, card, search, sitemap, admin) and still leaves the
 *   dirty row for the next one to forget;
 * - this reuses the tested function and runs by itself. New imports are
 *   cleaned by ProductIdentityService.save(); old rows wait for no re-parse,
 *   which a supplier banning us may never allow.
 *
 * **Once per rule version** (`SUPPLIER_TEXT_RULE_VERSION`): every product is
 * read once, by id order, and the cursor is saved after each chunk — a
 * restart resumes, a finished pass costs one settings read per boot. It runs
 * a minute after the worker starts and every night (04:27) in case a pass was
 * cut short; never in the API process. Text columns are never loaded in bulk
 * (dumps of up to 2.5 MB ran the worker out of heap on 2026-11-06): ids
 * first, then one row. Fields an admin or an AI task wrote (`lockedFields`,
 * `aiLockedFields`) are not touched, and nothing but text is written.
 */
@Injectable()
export class ProductTextCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ProductTextCleanupService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<TextCleanupReport>;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    // Boot passes belong to the worker: the API restarting must not repeat them.
    if (!runsBackgroundJobs()) return;
    if (process.env.PRODUCT_TEXT_CLEANUP_ON_BOOT === 'false') return;
    this.timer = setTimeout(() => void this.runLogged('Boot'), BOOT_DELAY_MS);
    this.timer.unref();
  }

  // :27 — clear of the parsing slots and of the 04:17 brand cleanup.
  @Cron('0 27 4 * * *')
  async nightly() {
    if (!runsBackgroundJobs()) return;
    await this.runLogged('Nightly');
  }

  onApplicationShutdown() {
    if (this.timer) clearTimeout(this.timer);
  }

  private async runLogged(label: string) {
    await this.run().catch((error: unknown) =>
      this.logger.error(
        `${label} product text cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  /** Resumes (or starts) the pass under the current rules. */
  run(): Promise<TextCleanupReport> {
    // One pass at a time: the boot pass and the nightly cron share it.
    this.running ??= this.pass().finally(() => (this.running = undefined));
    return this.running;
  }

  private async pass(): Promise<TextCleanupReport> {
    const cursor = await this.prisma.siteSetting.findUnique({
      where: { key: TEXT_CLEANUP_CURSOR_KEY },
    });
    if (cursor?.value === DONE)
      return { scanned: 0, updated: 0, alreadyDone: true };

    let afterId = cursor?.value ?? '';
    let scanned = 0;
    let updated = 0;

    for (;;) {
      const ids = await this.prisma.product.findMany({
        where: { id: { gt: afterId } },
        orderBy: { id: 'asc' },
        take: CHUNK,
        select: { id: true },
      });
      if (!ids.length) break;

      for (const { id } of ids) {
        if (await this.cleanOne(id)) updated++;
      }
      scanned += ids.length;
      afterId = ids[ids.length - 1].id;
      await this.saveCursor(afterId);
    }

    await this.saveCursor(DONE);
    this.logger.log(
      `Product text rules v${SUPPLIER_TEXT_RULE_VERSION}: rewrote ${updated} of ${scanned} products`,
    );
    return { scanned, updated };
  }

  /** Returns whether the product's text was rewritten. */
  private async cleanOne(id: string): Promise<boolean> {
    const row = await this.prisma.product.findUnique({
      where: { id },
      select: {
        name: true,
        descriptionShort: true,
        descriptionFull: true,
        seoTitle: true,
        seoDescription: true,
        lockedFields: true,
        aiLockedFields: true,
      },
    });
    if (!row) return false;

    // Ours stays ours: a field an admin or an AI task wrote is not the
    // supplier's text. It also does not feed a fallback of another field.
    const locked = new Set([...row.lockedFields, ...row.aiLockedFields]);
    const fields: ProductTextFields = { name: row.name };
    for (const key of TEXT_FIELDS) if (!locked.has(key)) fields[key] = row[key];

    const patch = cleanProductTexts(fields);
    if (!Object.keys(patch).length) return false;
    await this.prisma.product.update({
      where: { id },
      // The page text changed: the sitemap's lastmod moves with it.
      data: { ...patch, contentUpdatedAt: new Date() },
    });
    return true;
  }

  private async saveCursor(value: string) {
    await this.prisma.siteSetting.upsert({
      where: { key: TEXT_CLEANUP_CURSOR_KEY },
      create: { key: TEXT_CLEANUP_CURSOR_KEY, value },
      update: { value },
    });
  }
}
