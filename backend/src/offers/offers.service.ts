import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ProductMergeService } from './product-merge.service';
import {
  MatchConfidence,
  MatchSignal,
  compareProducts,
} from './product-matching';

export type DuplicateGroup = {
  signal: MatchSignal;
  confidence: MatchConfidence;
  key: string;
  products: Array<{
    id: string;
    name: string;
    slug: string;
    sku: string | null;
    barcode: string | null;
    model: string | null;
    costPrice: number | null;
    priceValue: number | null;
    brandName: string | null;
    offerCount: number;
    image: string | null;
  }>;
};

@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private merge: ProductMergeService,
  ) {}

  /**
   * Best available supplier cost for a product.
   *
   * In-stock offers win outright: a cheaper offer nobody can fulfil is not a
   * real price. Falls back to the cheapest offer of any kind so a fully
   * out-of-stock product still has a cost to price from.
   */
  async bestOfferCost(productId: string): Promise<number | null> {
    const offers = await this.prisma.sourceProduct.findMany({
      where: { productId, price: { not: null, gt: 0 } },
      select: { price: true, stock: true },
    });
    if (!offers.length) return null;

    const inStock = offers.filter((offer) => offer.stock);
    const pool = inStock.length ? inStock : offers;
    return pool.reduce(
      (best, offer) => Math.min(best, offer.price as number),
      Number.POSITIVE_INFINITY,
    );
  }

  /**
   * Re-prices a product from its cheapest offer. Called after a parser saves a
   * SourceProduct, so the storefront price reflects the best supplier rather
   * than whichever parser happened to run last.
   */
  async recomputeFromOffers(productId: string) {
    const cost = await this.bestOfferCost(productId);
    if (cost == null) return null;
    return this.pricing.applyCost(productId, cost);
  }

  /**
   * Single hook parsers call once a product and its offer are saved.
   *
   * Order matters: the offer must already exist, otherwise the price would be
   * computed from a stale set. Match keys are refreshed here too, so a product
   * becomes findable as a duplicate as soon as a supplier supplies the barcode
   * or article number that identifies it.
   */
  async onProductParsed(productId: string) {
    await this.merge.syncMatchKeys(productId);
    return this.recomputeFromOffers(productId);
  }

  /** Public view: how many suppliers carry this, and is any of them in stock. */
  async publicOfferSummary(productId: string) {
    const offers = await this.prisma.sourceProduct.findMany({
      where: { productId, price: { not: null, gt: 0 } },
      select: { stock: true },
    });

    return {
      offerCount: offers.length,
      inStockCount: offers.filter((offer) => offer.stock).length,
    };
  }

  /** Admin view: every offer with supplier, price and freshness. */
  async adminOffers(productId: string) {
    const offers = await this.prisma.sourceProduct.findMany({
      where: { productId },
      orderBy: [{ stock: 'desc' }, { price: 'asc' }],
      select: {
        id: true,
        url: true,
        name: true,
        sku: true,
        price: true,
        currency: true,
        stock: true,
        lastSync: true,
        source: { select: { id: true, name: true, code: true } },
      },
    });

    const best = await this.bestOfferCost(productId);
    return {
      data: offers.map((offer) => ({
        ...offer,
        isBest: best != null && offer.price === best && offer.stock,
      })),
      bestCost: best,
    };
  }

  /**
   * Manual merge from the admin: fold the duplicate in, then re-price, since
   * the survivor may now have a cheaper offer than it did a moment ago.
   */
  async mergeAndReprice(targetId: string, duplicateId: string) {
    const result = await this.merge.merge(targetId, duplicateId);
    await this.recomputeFromOffers(targetId);
    return result;
  }

  /**
   * Groups products that share a normalized identity key.
   *
   * Uses the stored match keys so this is three indexed group-bys rather than a
   * scan of the whole catalogue against itself.
   */
  async findDuplicates(limit = 50): Promise<DuplicateGroup[]> {
    const groups: DuplicateGroup[] = [];

    const dimensions: Array<{
      field: 'matchBarcode' | 'matchSku' | 'matchModel';
      signal: MatchSignal;
      confidence: MatchConfidence;
    }> = [
      { field: 'matchBarcode', signal: 'barcode', confidence: 'exact' },
      { field: 'matchSku', signal: 'sku', confidence: 'strong' },
      { field: 'matchModel', signal: 'model', confidence: 'likely' },
    ];

    // A product already reported under a stronger signal isn't reported again.
    const seen = new Set<string>();

    for (const dimension of dimensions) {
      if (groups.length >= limit) break;

      // Dynamic groupBy keys defeat Prisma's generated types, so the args are
      // assembled and cast once here rather than duplicating this block per field.
      const rows = (await this.prisma.product.groupBy({
        by: [dimension.field],
        where: { [dimension.field]: { not: null } },
        _count: { _all: true },
        having: { [dimension.field]: { _count: { gt: 1 } } },
        orderBy: { [dimension.field]: 'asc' },
        take: limit,
      } as never)) as unknown as Array<Record<string, string | null>>;

      for (const row of rows) {
        if (groups.length >= limit) break;
        const key = row[dimension.field];
        if (!key) continue;

        const products = await this.prisma.product.findMany({
          where: { [dimension.field]: key },
          select: {
            id: true,
            name: true,
            slug: true,
            sku: true,
            barcode: true,
            model: true,
            costPrice: true,
            priceValue: true,
            brand: { select: { name: true } },
            images: {
              orderBy: { order: 'asc' },
              take: 1,
              select: { url: true },
            },
            _count: { select: { sourceProducts: true } },
          },
        });

        const fresh = products.filter((product) => !seen.has(product.id));
        if (fresh.length < 2) continue;
        fresh.forEach((product) => seen.add(product.id));

        groups.push({
          signal: dimension.signal,
          confidence: dimension.confidence,
          key,
          products: fresh.map((product) => ({
            id: product.id,
            name: product.name,
            slug: product.slug,
            sku: product.sku,
            barcode: product.barcode,
            model: product.model,
            costPrice: product.costPrice,
            priceValue: product.priceValue,
            brandName: product.brand?.name ?? null,
            offerCount: product._count.sourceProducts,
            image: product.images[0]?.url ?? null,
          })),
        });
      }
    }

    return groups;
  }

  /**
   * Merges every group matched by barcode or brand+sku.
   *
   * Weaker signals are deliberately excluded — a wrong merge destroys a product
   * card and is tedious to unpick, so those stay a human decision.
   */
  async autoMerge() {
    const groups = await this.findDuplicates(500);
    let merged = 0;
    let skipped = 0;

    for (const group of groups) {
      if (group.confidence !== 'exact' && group.confidence !== 'strong') {
        skipped += 1;
        continue;
      }

      // Keep the product carrying the most offers; on a tie, the richer card.
      const [target, ...duplicates] = [...group.products].sort(
        (a, b) =>
          b.offerCount - a.offerCount || (b.image ? 1 : 0) - (a.image ? 1 : 0),
      );
      if (!target) continue;

      for (const duplicate of duplicates) {
        try {
          await this.merge.merge(target.id, duplicate.id);
          merged += 1;
        } catch (error) {
          this.logger.error(
            `Auto-merge ${duplicate.id} -> ${target.id} failed: ${String(error)}`,
          );
        }
      }

      await this.recomputeFromOffers(target.id);
    }

    return { groups: groups.length, merged, skipped };
  }

  /**
   * Suggestions for one product, for the "is this a duplicate of…" panel.
   * Scoped to the same category to keep the candidate set small.
   */
  async suggestionsFor(productId: string, limit = 10) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        model: true,
        categoryId: true,
        brand: { select: { name: true } },
      },
    });
    if (!product) return [];

    const candidates = await this.prisma.product.findMany({
      where: { categoryId: product.categoryId, id: { not: productId } },
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        barcode: true,
        model: true,
        priceValue: true,
        brand: { select: { name: true } },
      },
      take: 500,
    });

    const identity = {
      id: product.id,
      name: product.name,
      brandName: product.brand?.name ?? null,
      sku: product.sku,
      barcode: product.barcode,
      model: product.model,
    };

    return candidates
      .map((candidate) => ({
        candidate,
        match: compareProducts(identity, {
          id: candidate.id,
          name: candidate.name,
          brandName: candidate.brand?.name ?? null,
          sku: candidate.sku,
          barcode: candidate.barcode,
          model: candidate.model,
        }),
      }))
      .filter((row) => row.match !== null)
      .sort((a, b) => b.match!.score - a.match!.score)
      .slice(0, limit)
      .map((row) => ({
        id: row.candidate.id,
        name: row.candidate.name,
        slug: row.candidate.slug,
        priceValue: row.candidate.priceValue,
        brandName: row.candidate.brand?.name ?? null,
        signal: row.match!.signal,
        confidence: row.match!.confidence,
        score: row.match!.score,
      }));
  }
}
