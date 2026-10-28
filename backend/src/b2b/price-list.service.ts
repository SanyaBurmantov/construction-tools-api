import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { PriceListQueryDto } from './dto/b2b.dto';

const CHUNK = 2000;

const STOCK_LABEL: Record<string, string> = {
  in_stock: 'в наличии',
  out_of_stock: 'под заказ',
};

/**
 * The price list as XLSX — what a purchaser compares in their own sheet.
 * Streamed: the whole catalogue is ~50k rows, which would not belong in a
 * 512 MB heap as one workbook. Rows are read in id-cursor chunks and
 * committed as they go. Public data only: our price, never a supplier.
 */
@Injectable()
export class PriceListService {
  constructor(private prisma: PrismaService) {}

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
