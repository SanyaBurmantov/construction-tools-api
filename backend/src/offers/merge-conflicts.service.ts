import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OffersService } from './offers.service';

export type MergeConflictView = {
  id: string;
  signal: string;
  key: string;
  reason: string;
  priceRatio: number | null;
  detectedAt: Date;
  products: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    priceValue: number | null;
    image: string | null;
    offers: Array<{
      sourceName: string;
      url: string;
      price: number | null;
      stock: boolean;
    }>;
  }>;
};

/**
 * The admin's side of `MergeConflict`: groups the auto-merge would not fold
 * because they look like two different items. Two answers, both final:
 * «Один товар» merges them (dearest card stays, like the auto-merge) and
 * «Разные товары» keeps them apart for good. Admin-only — the view carries
 * supplier names, URLs and prices.
 */
@Injectable()
export class MergeConflictsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly offers: OffersService,
  ) {}

  async list(): Promise<MergeConflictView[]> {
    const rows = await this.prisma.mergeConflict.findMany({
      where: { dismissedAt: null },
      orderBy: { detectedAt: 'desc' },
      take: 200,
    });
    const ids = [...new Set(rows.flatMap((row) => row.productIds))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        priceValue: true,
        images: { orderBy: { order: 'asc' }, take: 1, select: { url: true } },
        sourceProducts: {
          orderBy: [{ stock: 'desc' }, { price: 'desc' }],
          select: {
            url: true,
            price: true,
            stock: true,
            source: { select: { name: true } },
          },
        },
      },
    });
    const byId = new Map(products.map((product) => [product.id, product]));

    return rows
      .map((row) => ({
        id: row.id,
        signal: row.signal,
        key: row.key,
        reason: row.reason,
        priceRatio: row.priceRatio,
        detectedAt: row.detectedAt,
        products: row.productIds
          .map((id) => byId.get(id))
          .filter((product) => product !== undefined)
          .map((product) => ({
            id: product.id,
            name: product.name,
            slug: product.slug,
            status: product.status,
            priceValue: product.priceValue,
            image: product.images[0]?.url ?? null,
            offers: product.sourceProducts.map((offer) => ({
              sourceName: offer.source.name,
              url: offer.url,
              price: offer.price,
              stock: offer.stock,
            })),
          })),
      }))
      .filter((conflict) => conflict.products.length > 1);
  }

  /** «Разные товары»: never merged, never listed again. */
  async dismiss(id: string, actor: string | null) {
    const result = await this.prisma.mergeConflict.updateMany({
      where: { id, dismissedAt: null },
      data: { dismissedAt: new Date(), dismissedBy: actor },
    });
    if (!result.count) throw new NotFoundException('Конфликт не найден');
    return { dismissed: true };
  }

  /**
   * «Один товар»: everything folds into `targetId`, or into the dearest card
   * on sale when none is given — the merged price is the dearest offer's.
   */
  async merge(id: string, targetId?: string) {
    const conflict = await this.prisma.mergeConflict.findUnique({
      where: { id },
    });
    if (!conflict || conflict.dismissedAt) {
      throw new NotFoundException('Конфликт не найден');
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: conflict.productIds } },
      select: { id: true, status: true, priceValue: true },
    });
    if (products.length < 2) {
      await this.prisma.mergeConflict.delete({ where: { id } });
      return { merged: 0 };
    }
    const target =
      (targetId && products.find((product) => product.id === targetId)) ||
      [...products].sort(
        (a, b) =>
          Number(b.status === 'PUBLISHED') - Number(a.status === 'PUBLISHED') ||
          (b.priceValue ?? 0) - (a.priceValue ?? 0),
      )[0];
    let merged = 0;
    for (const product of products) {
      if (product.id === target.id) continue;
      await this.offers.mergeAndReprice(target.id, product.id);
      merged += 1;
    }
    await this.prisma.mergeConflict.delete({ where: { id } });
    return { merged, targetId: target.id };
  }
}
