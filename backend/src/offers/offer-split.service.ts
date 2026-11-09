import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OffersService } from './offers.service';
import { planSplit, type SplitGroup } from './offer-split';
import { slugFromNameAndCode } from '../products/product-slug';
import { queueTable } from '../parser/queue-table';

const MAX_SLUG_ATTEMPTS = 50;

/**
 * Takes apart cards that hold several products (offer-split.ts): each other
 * article of a supplier becomes its own DRAFT product, and every URL of the
 * card goes to the front of its supplier's queue. The ordinary parse then
 * fills each card — name, brand, photos, specs, category — and prices and
 * publishes it through the usual path; the old card is re-priced from the
 * offers it kept. Runs by itself in the worker (OfferSplitCron) and also
 * catches any card that collapses again.
 */
@Injectable()
export class OfferSplitService {
  private readonly logger = new Logger(OfferSplitService.name);

  constructor(
    private prisma: PrismaService,
    private offers: OffersService,
  ) {}

  /** Cards where one supplier lists two or more different articles. */
  private async candidates(limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "productId" AS id FROM (
        SELECT "productId", "sourceId",
          count(DISTINCT upper(regexp_replace(coalesce("sku", ''), '[^0-9A-Za-zА-Яа-яЁё]', '', 'g')))
            FILTER (WHERE regexp_replace(coalesce("sku", ''), '[^0-9A-Za-zА-Яа-яЁё]', '', 'g') <> '') AS articles
        FROM "SourceProduct" WHERE "productId" IS NOT NULL
        GROUP BY 1, 2
      ) per_source
      WHERE articles > 1
      GROUP BY 1 ORDER BY 1 LIMIT ${limit}`;
    return rows.map((row) => row.id);
  }

  async splitBatch(limit = 200) {
    const ids = await this.candidates(limit);
    let created = 0;
    for (const id of ids) {
      try {
        created += await this.splitProduct(id);
      } catch (error) {
        this.logger.error(`Split of ${id} failed: ${String(error)}`);
      }
    }
    if (ids.length) {
      this.logger.log(
        `Split ${ids.length} cards into ${created} new products; their URLs are queued for parsing`,
      );
    }
    return { cards: ids.length, created };
  }

  /** Returns how many products were created. */
  async splitProduct(productId: string): Promise<number> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, categoryId: true, priceCurrency: true },
    });
    if (!product) return 0;
    // The owner first, exactly as ProductIdentityService orders them.
    const offers = await this.prisma.sourceProduct.findMany({
      where: { productId },
      select: { id: true, sourceId: true, url: true, sku: true, name: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const groups = planSplit(offers);
    if (!groups.length) return 0;

    for (const group of groups) {
      await this.createProductFor(group, product);
    }
    await this.requeue(offers);
    // The card priced itself at the cheapest of all the articles it held.
    await this.offers.recomputeFromOffers(productId);
    return groups.length;
  }

  private async createProductFor(
    group: SplitGroup,
    origin: { categoryId: string; priceCurrency: string | null },
  ) {
    const first = group.offers[0];
    const base = slugFromNameAndCode(first.name, first.sku) || 'product';
    for (let attempt = 0; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const redirect = await this.prisma.productRedirect.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (redirect) continue;
      try {
        await this.prisma.$transaction(async (tx) => {
          // Not on sale until the parse has filled it and the price engine
          // has priced it (publishIfReady), like any new product.
          const created = await tx.product.create({
            data: {
              name: first.name,
              slug,
              sku: first.sku,
              categoryId: origin.categoryId,
              priceCurrency: origin.priceCurrency ?? 'BYN',
              status: 'DRAFT',
              statusSource: 'SYSTEM',
            },
          });
          await tx.sourceProduct.updateMany({
            where: { id: { in: group.offers.map((offer) => offer.id) } },
            data: { productId: created.id },
          });
        });
        return;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          continue;
        throw error;
      }
    }
    throw new Error(`No free slug for «${base}»`);
  }

  /** To the front of the line: never-seen-first claims a null `visitedAt`. */
  private async requeue(offers: Array<{ sourceId: string; url: string }>) {
    const sources = await this.prisma.source.findMany({
      where: { id: { in: [...new Set(offers.map((o) => o.sourceId))] } },
      select: { id: true, code: true },
    });
    for (const source of sources) {
      const queue = queueTable(this.prisma, source.code);
      if (!queue) continue;
      const urls = offers
        .filter((offer) => offer.sourceId === source.id)
        .map((offer) => offer.url);
      await queue.createMany({
        data: urls.map((url) => ({ url })),
        skipDuplicates: true,
      });
      await queue.updateMany({
        where: { url: { in: urls } },
        data: {
          isVisited: false,
          status: 'PENDING',
          attempts: 0,
          lastError: null,
          lastTriedAt: null,
          visitedAt: null,
        },
      });
    }
  }
}
