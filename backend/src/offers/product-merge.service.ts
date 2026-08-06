import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildMatchKeys } from './product-matching';

@Injectable()
export class ProductMergeService {
  private readonly logger = new Logger(ProductMergeService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Folds `duplicateId` into `targetId`, so one canonical card carries every
   * supplier's offer.
   *
   * Everything that hangs off the duplicate is moved first — `Review` and
   * `PriceHistory` cascade on delete, so skipping that would silently destroy
   * customer reviews. The duplicate's slug becomes a redirect rather than a
   * 404, and the whole thing runs in one transaction: a half-merged product
   * would be worse than either outcome.
   */
  async merge(targetId: string, duplicateId: string) {
    if (targetId === duplicateId) {
      throw new BadRequestException('Нельзя объединить товар с самим собой');
    }

    const [target, duplicate] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id: targetId },
        include: { images: true, productSpecs: true },
      }),
      this.prisma.product.findUnique({
        where: { id: duplicateId },
        include: { images: true, productSpecs: true },
      }),
    ]);

    if (!target) throw new NotFoundException('Целевой товар не найден');
    if (!duplicate) throw new NotFoundException('Дубль не найден');

    const targetImageUrls = new Set(target.images.map((image) => image.url));
    const targetSpecIds = new Set(
      target.productSpecs.map((spec) => spec.specificationId),
    );

    // Images the target doesn't already have, appended after its own.
    const imagesToMove = duplicate.images.filter(
      (image) => !targetImageUrls.has(image.url),
    );
    let nextOrder = target.images.length;

    // Specs the target lacks. `@@unique([productId, specificationId])` means
    // moving a duplicate spec would throw, so overlaps are dropped instead.
    const specsToMove = duplicate.productSpecs.filter(
      (spec) => !targetSpecIds.has(spec.specificationId),
    );

    await this.prisma.$transaction(async (tx) => {
      // Offers: the whole point of the merge.
      await tx.sourceProduct.updateMany({
        where: { productId: duplicateId },
        data: { productId: targetId },
      });

      // Cascade-deleted relations — must move before the delete below.
      await tx.review.updateMany({
        where: { productId: duplicateId },
        data: { productId: targetId },
      });
      await tx.priceHistory.updateMany({
        where: { productId: duplicateId },
        data: { productId: targetId },
      });

      // Order lines keep pointing at a real product so order history stays
      // navigable (they also carry their own name/price snapshot).
      await tx.orderItem.updateMany({
        where: { productId: duplicateId },
        data: { productId: targetId },
      });

      for (const image of imagesToMove) {
        await tx.productImage.update({
          where: { id: image.id },
          data: { productId: targetId, order: nextOrder },
        });
        nextOrder += 1;
      }
      await tx.productImage.deleteMany({ where: { productId: duplicateId } });

      for (const spec of specsToMove) {
        await tx.productSpecification.update({
          where: { id: spec.id },
          data: { productId: targetId },
        });
      }
      await tx.productSpecification.deleteMany({
        where: { productId: duplicateId },
      });

      // Redirects pointing at the duplicate must follow it, or they'd break.
      await tx.productRedirect.updateMany({
        where: { productId: duplicateId },
        data: { productId: targetId },
      });
      await tx.productRedirect.upsert({
        where: { slug: duplicate.slug },
        update: { productId: targetId },
        create: { slug: duplicate.slug, productId: targetId },
      });

      await tx.product.delete({ where: { id: duplicateId } });

      // Fill identity gaps from the duplicate: whichever supplier knew the
      // barcode wins, rather than losing it with the deleted row.
      const identity = {
        sku: target.sku ?? duplicate.sku,
        barcode: target.barcode ?? duplicate.barcode,
        model: target.model ?? duplicate.model,
        brandId: target.brandId ?? duplicate.brandId,
        descriptionShort: target.descriptionShort ?? duplicate.descriptionShort,
        descriptionFull: target.descriptionFull ?? duplicate.descriptionFull,
      };

      await tx.product.update({
        where: { id: targetId },
        data: identity,
      });
    });

    // Rating and match keys depend on the merged-in rows, so they're rebuilt
    // after the transaction commits.
    await this.syncRating(targetId);
    await this.syncMatchKeys(targetId);

    this.logger.log(`Merged product ${duplicateId} into ${targetId}`);
    return { ok: true, targetId };
  }

  /** Recomputes the denormalized review aggregate after reviews moved. */
  private async syncRating(productId: string) {
    const grouped = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { productId, status: 'APPROVED' },
      _count: { rating: true },
    });

    let count = 0;
    let sum = 0;
    for (const row of grouped) {
      count += row._count.rating;
      sum += row.rating * row._count.rating;
    }

    await this.prisma.product.update({
      where: { id: productId },
      data: {
        ratingAvg: count ? Math.round((sum / count) * 10) / 10 : null,
        ratingCount: count,
      },
    });
  }

  /** Rebuilds the dedup keys from the product's current identity fields. */
  async syncMatchKeys(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        model: true,
        brand: { select: { name: true } },
      },
    });
    if (!product) return;

    const keys = buildMatchKeys({
      id: product.id,
      name: product.name,
      brandName: product.brand?.name ?? null,
      sku: product.sku,
      barcode: product.barcode,
      model: product.model,
    });

    await this.prisma.product.update({ where: { id: productId }, data: keys });
  }

  /** Backfill for products created before match keys existed. */
  async rebuildAllMatchKeys() {
    let cursor: string | undefined;
    let processed = 0;

    for (;;) {
      const batch = await this.prisma.product.findMany({
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          model: true,
          brand: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (!batch.length) break;

      for (const product of batch) {
        const keys = buildMatchKeys({
          id: product.id,
          name: product.name,
          brandName: product.brand?.name ?? null,
          sku: product.sku,
          barcode: product.barcode,
          model: product.model,
        });
        await this.prisma.product.update({
          where: { id: product.id },
          data: keys,
        });
        processed += 1;
      }

      cursor = batch[batch.length - 1].id;
    }

    return { processed };
  }
}
