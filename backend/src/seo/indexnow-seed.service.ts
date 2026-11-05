import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FALLBACK_CATEGORY_SLUG } from '../common/constants/catalog';
import {
  brandPath,
  categoryPath,
  IndexNowService,
  productPath,
} from './indexnow.service';

const CURSOR_KEY = 'indexnow.seed.cursor';
const DONE_KEY = 'indexnow.seed.doneAt';
const DEFAULT_PER_DAY = 10_000;

/**
 * Introduces the whole catalogue to Yandex through IndexNow, once.
 *
 * IndexNow used to carry only what AI or an admin rewrote; every other page
 * waited for the robot to find it in the sitemap — and in the shop's first
 * weeks Yandex sent 2 visits against Google's 133 (Metrika, 2026-11-05). Each
 * night the worker queues the next `INDEXNOW_SEED_PER_DAY` (10 000) product
 * pages by id, after the listed categories and brands on the first night;
 * a keyset cursor in `SiteSetting` survives restarts, and when it runs out the
 * pass is marked done and stops. New products are announced as they go on
 * sale (`OffersService.publishIfReady`), so nothing needs a second pass.
 * Set `INDEXNOW_SEED_PER_DAY=0` to switch it off.
 */
@Injectable()
export class IndexNowSeedService {
  private readonly logger = new Logger(IndexNowSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexNow: IndexNowService,
  ) {}

  private perDay(): number {
    const raw = process.env.INDEXNOW_SEED_PER_DAY;
    const n = raw === undefined || raw === '' ? DEFAULT_PER_DAY : Number(raw);
    return Number.isFinite(n) && n >= 0
      ? Math.min(Math.floor(n), 10_000)
      : DEFAULT_PER_DAY;
  }

  private async setting(key: string) {
    return (await this.prisma.siteSetting.findUnique({ where: { key } }))
      ?.value;
  }

  private async save(key: string, value: string) {
    await this.prisma.siteSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  /** Nightly in the worker, before the morning crawls; off the parser slots. */
  @Cron('0 11 5 * * *')
  async handle() {
    await this.seedNext();
  }

  /** Queues the next slice; returns how many URLs were queued. */
  async seedNext(): Promise<number> {
    const limit = this.perDay();
    if (!limit || !this.indexNow.enabled) return 0;
    if (await this.setting(DONE_KEY)) return 0;

    const cursor = await this.setting(CURSOR_KEY);
    const paths: string[] = [];

    if (!cursor) {
      // First night: the listed categories (with their ancestors) and brands.
      const categories = await this.prisma.$queryRaw<Array<{ slug: string }>>`
        WITH RECURSIVE up AS (
          SELECT c.id, c."parentId", c.slug, c."isVisible"
          FROM "Category" c
          WHERE EXISTS (
            SELECT 1 FROM "Product" p
            WHERE p."categoryId" = c.id AND p.status = 'PUBLISHED'
          )
          UNION
          SELECT parent.id, parent."parentId", parent.slug, parent."isVisible"
          FROM "Category" parent JOIN up ON up."parentId" = parent.id
        )
        SELECT DISTINCT slug FROM up
        WHERE "isVisible" AND slug <> ${FALLBACK_CATEGORY_SLUG}`;
      const brands = await this.prisma.$queryRaw<Array<{ slug: string }>>`
        SELECT b.slug FROM "Brand" b
        WHERE EXISTS (
          SELECT 1 FROM "Product" p
          WHERE p."brandId" = b.id AND p.status = 'PUBLISHED'
        )`;
      paths.push('/', '/catalog', '/brand', '/sales');
      paths.push(...categories.map((c) => categoryPath(c.slug)));
      paths.push(...brands.map((b) => brandPath(b.slug)));
    }

    const room = Math.max(0, limit - paths.length);
    const products = room
      ? await this.prisma.product.findMany({
          where: {
            status: 'PUBLISHED',
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: 'asc' },
          take: room,
          select: { id: true, slug: true },
        })
      : [];
    paths.push(...products.map((p) => productPath(p.slug)));

    await this.indexNow.enqueue(paths);
    const last = products[products.length - 1];
    // '0' sorts before every uuid: the first night is done even when the
    // categories alone filled it, and they are not queued again.
    await this.save(CURSOR_KEY, last?.id ?? cursor ?? '0');
    if (room > 0 && products.length < room) {
      await this.save(DONE_KEY, new Date().toISOString());
    }
    this.logger.log(
      `IndexNow seed: ${paths.length} URL(s) queued (${products.length} products)`,
    );
    return paths.length;
  }
}
