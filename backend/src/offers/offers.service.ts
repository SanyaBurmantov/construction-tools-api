import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { pickBestOffer } from './best-offer';
import { ProductMergeService } from './product-merge.service';
import {
  MatchConfidence,
  MatchSignal,
  compareProducts,
  isAutoMergeable,
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

  /** Best available supplier cost for a product (see `pickBestOffer`). */
  async bestOfferCost(productId: string): Promise<number | null> {
    return (await this.bestOffer(productId))?.price ?? null;
  }

  private async bestOffer(productId: string) {
    const offers = await this.prisma.sourceProduct.findMany({
      where: { productId, price: { not: null, gt: 0 } },
      select: { price: true, stock: true, specifications: true },
    });
    return pickBestOffer(offers);
  }

  /**
   * Re-prices a product from its cheapest offer. Called after a parser saves a
   * SourceProduct, so the storefront price reflects the best supplier rather
   * than whichever parser happened to run last.
   */
  async recomputeFromOffers(productId: string) {
    const offer = await this.bestOffer(productId);
    if (!offer) {
      // Nobody has a price for it now. It used to keep whatever price it had
      // last — on sale at a cost the supplier no longer quotes. The card stays
      // (its page keeps its place in search), without a price and out of stock.
      await this.pricing.withdrawPrice(productId);
      await this.prisma.product.update({
        where: { id: productId },
        data: { stockStatus: 'out_of_stock' },
      });
      return null;
    }
    const result = await this.pricing.applyCost(productId, offer.price, {
      oldCost: offer.oldPrice,
    });
    await this.prisma.product.update({
      where: { id: productId },
      data: { stockStatus: offer.stockStatus },
    });
    await this.publishIfReady(productId);
    return result;
  }

  /**
   * The automatic half of the publication rules: a product the *system* put
   * in DRAFT (just created) or HIDDEN (every offer delisted) goes on sale as
   * soon as it has a live offer and a price. Nothing an admin set is touched
   * (`statusSource = ADMIN`), and ARCHIVED never comes back on its own.
   *
   * This replaces the per-batch `publishDraftProducts()` that republished
   * everything in DRAFT — including what an admin had parked there — and is
   * what lets a product a supplier briefly 404'd return by itself.
   */
  private async publishIfReady(productId: string) {
    const published = await this.prisma.product.updateMany({
      where: {
        id: productId,
        statusSource: 'SYSTEM',
        status: { in: ['DRAFT', 'HIDDEN'] },
        priceValue: { gt: 0 },
      },
      data: { status: 'PUBLISHED' },
    });
    return published.count > 0;
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

  /**
   * The supplier no longer serves this URL (404/410), so the offer is withdrawn.
   *
   * Leaving it in place is the expensive failure: the card keeps the dead
   * supplier's price and in-stock flag, and a customer orders something nobody
   * can ship. Clearing the price also takes the offer out of the cost
   * calculation, so the product re-prices from whoever still carries it.
   */
  async delistOffer(sourceId: string, url: string) {
    const offer = await this.prisma.sourceProduct.findUnique({
      where: { sourceId_url: { sourceId, url } },
      select: { id: true, productId: true, price: true },
    });
    // Unknown, or already withdrawn by an earlier pass (the weekly re-check
    // of SKIPPED rows lands here again): nothing to do.
    if (!offer || offer.price == null) {
      return { delisted: false, productHidden: false };
    }

    await this.prisma.sourceProduct.update({
      where: { id: offer.id },
      data: { stock: false, price: null, lastSync: new Date() },
    });

    if (!offer.productId) return { delisted: true, productHidden: false };

    const remaining = await this.prisma.sourceProduct.count({
      where: { productId: offer.productId, price: { not: null, gt: 0 } },
    });

    if (remaining > 0) {
      await this.recomputeFromOffers(offer.productId);
      return { delisted: true, productHidden: false };
    }

    // Nobody carries it any more. Hide rather than delete: reviews, order
    // history and the slug redirect all still point here. Only a status the
    // system set is changed, and it stays SYSTEM — so `publishIfReady` brings
    // the product back when a supplier lists it again. Anything an admin
    // decided (statusSource ADMIN) is left as it is.
    const product = await this.prisma.product.findUnique({
      where: { id: offer.productId },
      select: { status: true, statusSource: true },
    });
    const hideable =
      product?.statusSource === 'SYSTEM' &&
      (product.status === 'PUBLISHED' || product.status === 'DRAFT');

    await this.prisma.product.update({
      where: { id: offer.productId },
      data: {
        stockStatus: 'out_of_stock',
        ...(hideable ? { status: 'HIDDEN' as const } : {}),
      },
    });

    this.logger.warn(
      `Product ${offer.productId} has no live offers left — hidden from the storefront`,
    );
    return { delisted: true, productHidden: hideable };
  }

  /** Admin view: every offer with supplier, price and freshness. */
  /**
   * Which supplier(s) each of these products was parsed from — admin-only, and
   * the one query behind the "откуда спаршен" line on the admin screens.
   *
   * Batched on purpose: the products list, an order's items and the catalogue
   * cards all need it for many products at once, and one `IN` beats N
   * requests. Returns a plain map so the caller can look up by product id.
   */
  async adminSourcesFor(productIds: string[]) {
    if (!productIds.length) return {};

    const offers = await this.prisma.sourceProduct.findMany({
      where: { productId: { in: productIds } },
      orderBy: [{ stock: 'desc' }, { price: 'asc' }],
      select: {
        productId: true,
        url: true,
        price: true,
        currency: true,
        stock: true,
        lastSync: true,
        source: { select: { id: true, name: true, code: true } },
      },
    });

    const byProduct: Record<
      string,
      Array<{
        sourceId: string;
        sourceName: string;
        sourceCode: string;
        url: string;
        price: number | null;
        currency: string | null;
        stock: boolean;
        lastSync: Date;
      }>
    > = {};

    for (const offer of offers) {
      if (!offer.productId) continue;
      (byProduct[offer.productId] ??= []).push({
        sourceId: offer.source.id,
        sourceName: offer.source.name,
        sourceCode: offer.source.code,
        url: offer.url,
        price: offer.price,
        currency: offer.currency,
        stock: offer.stock,
        lastSync: offer.lastSync,
      });
    }

    return byProduct;
  }

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

    // Same rule the price is computed by: in stock wins, and with nothing in
    // stock the cheapest offer of any kind is still the one priced from — it
    // used to be marked nowhere.
    const best = pickBestOffer(
      offers.map((offer) => ({ ...offer, specifications: null })),
    );
    const anyInStock = offers.some(
      (offer) => offer.stock && offer.price != null && offer.price > 0,
    );
    return {
      data: offers.map((offer) => ({
        ...offer,
        isBest:
          best != null &&
          offer.price === best.price &&
          (offer.stock || !anyInStock),
      })),
      bestCost: best?.price ?? null,
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
      if (!isAutoMergeable(group)) {
        skipped += 1;
        continue;
      }

      // Products an admin hid or archived are a human decision: they are
      // neither folded away automatically nor allowed to absorb a live card.
      const states = new Map(
        (
          await this.prisma.product.findMany({
            where: { id: { in: group.products.map((p) => p.id) } },
            select: {
              id: true,
              status: true,
              statusSource: true,
              _count: {
                select: {
                  sourceProducts: { where: { price: { not: null, gt: 0 } } },
                },
              },
            },
          })
        ).map((row) => [row.id, row]),
      );
      const candidates = group.products.filter((product) => {
        const state = states.get(product.id);
        return (
          state &&
          !(
            state.statusSource === 'ADMIN' &&
            (state.status === 'HIDDEN' || state.status === 'ARCHIVED')
          )
        );
      });
      if (candidates.length < 2) {
        skipped += 1;
        continue;
      }

      // Survivor: on sale first, then the most *live* offers (a dead offer
      // with no price is not worth keeping a card for), then the richer card.
      const live = (id: string) => states.get(id)?._count.sourceProducts ?? 0;
      const onSale = (id: string) =>
        states.get(id)?.status === 'PUBLISHED' ? 1 : 0;
      const [target, ...duplicates] = [...candidates].sort(
        (a, b) =>
          onSale(b.id) - onSale(a.id) ||
          live(b.id) - live(a.id) ||
          b.offerCount - a.offerCount ||
          (b.image ? 1 : 0) - (a.image ? 1 : 0),
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
