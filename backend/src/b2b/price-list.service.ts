import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { PrismaService } from '../prisma/prisma.service';
import { PriceListQueryDto } from './dto/b2b.dto';

const CHUNK = 2000;

const STOCK_LABEL: Record<string, string> = {
  in_stock: 'в наличии',
  out_of_stock: 'под заказ',
};

/**
 * The price list as XLSX — what a purchaser compares in their own sheet.
 * Streamed: the whole catalogue is ~120k rows (2026-11), which would not
 * belong in the heap as one workbook. Rows are read in id-cursor chunks and
 * committed as they go. Public data only: our price, never a supplier.
 */
const PRICE_LIST_MAX_WAITING = 3;

/** A built file is served as is for this long, then rebuilt on demand. */
export const PRICE_LIST_FRESH_MS = 60 * 60 * 1000;
/** Built files kept (whole catalogue + categories/brands people asked for). */
const PRICE_LIST_MAX_FILES = 60;

export type PriceListFile = {
  path: string;
  filename: string;
  size: number;
  builtAt: number;
};

@Injectable()
export class PriceListService {
  private readonly logger = new Logger(PriceListService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Built files on the container's disk, by filter. Not shared, not kept
   * across a restart: the first request after a deploy builds again.
   */
  private readonly dir =
    process.env.PRICE_LIST_CACHE_DIR || join(tmpdir(), 'gost-price-list');
  private readonly files = new Map<string, PriceListFile>();
  private readonly building = new Map<string, Promise<PriceListFile>>();

  /**
   * The file for this filter, built at most once an hour.
   *
   * It used to be built per request: one at a time, three waiting, the rest
   * 503. The whole catalogue (120k rows, 17.8 MB) is a ~10 s build, and a
   * crawler from Alibaba Cloud (112 rotating addresses, 18–23.11.2026) asked
   * for it faster than that all day long — the queue was never empty, and a
   * buyer pressing «Скачать прайс» got «формируется для другого покупателя»
   * ~530 times in a day. Now every
   * request for one filter shares one build; a fresh file is sent from disk
   * without touching the database, and a stale one is still sent at once
   * while the new one is built behind it.
   */
  async file(query: PriceListQueryDto): Promise<PriceListFile> {
    const key = priceListKey(query);
    const cached = this.files.get(key);
    if (cached && Date.now() - cached.builtAt < PRICE_LIST_FRESH_MS) {
      return cached;
    }
    if (cached) {
      this.build(key, query).catch((error: unknown) =>
        this.logger.warn(`Price list rebuild deferred: ${String(error)}`),
      );
      return cached;
    }
    return this.build(key, query);
  }

  /** One build per filter at a time; every caller of it waits for the same. */
  private build(key: string, query: PriceListQueryDto) {
    const running = this.building.get(key);
    if (running) return running;
    const promise = (async () => {
      // Resolved first, so an unknown category is a clean 404, and outside
      // the slot, so a 404 never waits behind a build.
      const prepared = await this.prepare(query);
      return this.exclusive(() => this.writeFile(key, prepared));
    })().finally(() => this.building.delete(key));
    this.building.set(key, promise);
    return promise;
  }

  private async writeFile(
    key: string,
    prepared: Awaited<ReturnType<PriceListService['prepare']>>,
  ): Promise<PriceListFile> {
    await mkdir(this.dir, { recursive: true });
    const name = createHash('sha1').update(key).digest('hex').slice(0, 16);
    const path = join(this.dir, `${name}.xlsx`);
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    const started = Date.now();
    try {
      const out = createWriteStream(tmp);
      await this.write(prepared, out);
      await finished(out);
      // A rename replaces the file atomically; a download already reading
      // the old one keeps its descriptor.
      await rename(tmp, path);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    const { size } = await stat(path);
    const file = {
      path,
      filename: prepared.filename,
      size,
      builtAt: Date.now(),
    };
    this.files.delete(key);
    this.files.set(key, file);
    this.logger.log(
      `Built price list "${prepared.title}": ${Math.round(size / 1024)} KB in ${Math.round((Date.now() - started) / 1000)} s`,
    );
    await this.prune();
    return file;
  }

  /** Oldest built files go first once there are too many. */
  private async prune() {
    for (const [key, file] of this.files) {
      if (this.files.size <= PRICE_LIST_MAX_FILES) break;
      this.files.delete(key);
      await rm(file.path, { force: true });
    }
  }

  /**
   * One build at a time, a few more waiting, the rest 503: a build reads the
   * whole catalogue, and a crawler asking for many different categories must
   * not run them side by side (audit 2026-10-30).
   */
  private running = false;
  private readonly waiting: Array<() => void> = [];

  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.running) {
      if (this.waiting.length >= PRICE_LIST_MAX_WAITING)
        throw new ServiceUnavailableException(
          'Прайс-лист сейчас формируется, повторите через минуту',
        );
      // `finally` hands the slot over without clearing `running`.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running = true;
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running = false;
    }
  }

  /** Subtree ids of a category (cycle-safe: bounded depth). */
  private async categoryScope(slug: string) {
    const root = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true, name: true },
    });
    if (!root) throw new NotFoundException('Категория не найдена');
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE sub(id, depth) AS (
        SELECT ${root.id}::text, 0
        UNION
        SELECT c."id", sub.depth + 1 FROM "Category" c
        JOIN sub ON c."parentId" = sub.id
        WHERE sub.depth < 20
      )
      SELECT DISTINCT id FROM sub`;
    return { name: root.name, ids: rows.map((r) => r.id) };
  }

  /** The file name and the filter, resolved before any byte is written. */
  async prepare(query: PriceListQueryDto) {
    const where: Prisma.ProductWhereInput = {
      status: 'PUBLISHED',
      priceValue: { gt: 0 },
      // A hidden branch (the parser's fallback bucket among them) is not
      // something we offer.
      category: { isVisible: true },
    };
    const titleParts: string[] = [];
    if (query.categorySlug) {
      const scope = await this.categoryScope(query.categorySlug);
      where.categoryId = { in: scope.ids };
      titleParts.push(scope.name);
    }
    if (query.brandSlug) {
      const brand = await this.prisma.brand.findUnique({
        where: { slug: query.brandSlug },
        select: { id: true, name: true },
      });
      if (!brand) throw new NotFoundException('Бренд не найден');
      where.brandId = brand.id;
      titleParts.push(brand.name);
    }
    if (query.inStock) where.stockStatus = 'in_stock';
    const slug = [query.categorySlug, query.brandSlug]
      .filter(Boolean)
      .join('-');
    return {
      where,
      title: titleParts.length ? titleParts.join(' · ') : 'Весь каталог',
      filename: `gost-by-price${slug ? `-${slug}` : ''}.xlsx`,
    };
  }

  /** Streams the workbook into `out`. */
  async write(
    prepared: Awaited<ReturnType<PriceListService['prepare']>>,
    out: Writable,
  ) {
    const origin = (process.env.PUBLIC_ORIGIN || 'https://gost.by').replace(
      /\/$/,
      '',
    );
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: out,
      useStyles: true,
      useSharedStrings: false,
    });
    const sheet = workbook.addWorksheet('Прайс', {
      views: [{ state: 'frozen', ySplit: 3 }],
    });
    sheet.columns = [
      { key: 'sku', width: 18 },
      { key: 'name', width: 70 },
      { key: 'brand', width: 18 },
      { key: 'category', width: 30 },
      { key: 'price', width: 14, style: { numFmt: '#,##0.00' } },
      { key: 'stock', width: 12 },
      { key: 'url', width: 50 },
    ];
    const date = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Minsk',
    }).format(new Date());
    sheet.addRow([
      `Прайс-лист gost.by — ${prepared.title}, цены на ${date}, BYN`,
    ]).font = { bold: true, size: 12 };
    sheet.getRow(1).commit();
    sheet.addRow([`Счёт на организацию — в корзине на ${origin}`]).commit();
    const header = sheet.addRow([
      'Артикул',
      'Наименование',
      'Бренд',
      'Категория',
      'Цена, BYN',
      'Наличие',
      'Ссылка',
    ]);
    header.font = { bold: true };
    header.commit();

    let cursor: string | undefined;
    for (;;) {
      const products = await this.prisma.product.findMany({
        where: prepared.where,
        orderBy: { id: 'asc' },
        take: CHUNK,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          sku: true,
          name: true,
          slug: true,
          priceValue: true,
          stockStatus: true,
          brand: { select: { name: true } },
          category: { select: { name: true } },
        },
      });
      for (const p of products) {
        sheet
          .addRow({
            sku: p.sku ?? '',
            name: p.name,
            brand: p.brand?.name ?? '',
            category: p.category.name,
            price: p.priceValue,
            stock: STOCK_LABEL[p.stockStatus ?? ''] ?? '',
            url: `${origin}/product/${p.slug}`,
          })
          .commit();
      }
      if (products.length < CHUNK) break;
      cursor = products[products.length - 1].id;
    }
    sheet.commit();
    await workbook.commit();
  }
}

/** The cache key of a filter: the same list is the same file. */
export function priceListKey(query: PriceListQueryDto) {
  return JSON.stringify([
    query.categorySlug ?? '',
    query.brandSlug ?? '',
    query.inStock ? 1 : 0,
  ]);
}
