import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withoutPlaceholderImages } from '../../common/utils/product-images';
import { COMPATIBILITY_RULE_VERSION } from './compatibility';
import { similarityScore } from './similarity';
import {
  RECOMMENDATION_CARD_SELECT,
  SIMILARITY_SELECT,
  accessorySignatureSql,
  targetSignatureSql,
} from './relation-select';
import { RecommendationsQueryDto } from './recommendations.dto';

const PAGE_SIZE = 4;
const CANDIDATE_LIMIT = 120;
type Card = Prisma.ProductGetPayload<{
  select: typeof RECOMMENDATION_CARD_SELECT;
}>;
type SimilarityRow = Prisma.ProductGetPayload<{
  select: typeof SIMILARITY_SELECT;
}>;

/** Explicit projection also prevents internal ranking inputs reaching SSR. */
export function recommendationCard(product: Card) {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    sku: product.sku,
    priceValue: product.priceValue,
    oldPrice: product.oldPrice,
    priceCurrency: product.priceCurrency,
    stockStatus: product.stockStatus,
    stockQuantity: product.stockQuantity,
    ratingAvg: product.ratingAvg,
    ratingCount: product.ratingCount,
    brand: product.brand,
    category: product.category,
    images: withoutPlaceholderImages(product.images).slice(0, 1),
  };
}

@Injectable()
export class RecommendationsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(slug: string, query: RecommendationsQueryDto) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: SIMILARITY_SELECT,
    });
    if (!product) throw new NotFoundException('Товар не найден');
    const [similar, accessories, fits] = await Promise.all([
      this.similar(product),
      this.compatible(product.id, 'accessories', query.accessoriesPage),
      this.compatible(product.id, 'fits', query.fitsPage),
    ]);
    return { similar, accessories, fits };
  }

  /**
   * Same category, the closest names first (pg_trgm), ranked by kind, title,
   * specs, price and brand. When fewer than four share the kind, the rest of
   * the row is the category's closest names — the block never goes empty for
   * a product that has neighbours.
   */
  private async similar(product: SimilarityRow) {
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Product"
      WHERE "categoryId" = ${product.categoryId} AND "status" = 'PUBLISHED'
        AND "id" <> ${product.id} AND "priceValue" > 0
      ORDER BY similarity("name", ${product.name}) DESC, "listingRank" DESC, "id"
      LIMIT ${CANDIDATE_LIMIT}`;
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      select: SIMILARITY_SELECT,
    });
    const order = new Map(ids.map((row, index) => [row.id, index]));
    const candidates = rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: similarityScore(product, candidate),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.candidate.id.localeCompare(b.candidate.id),
      )
      .map(({ candidate }) => candidate);
    const picked = new Set(ranked.map((candidate) => candidate.id));
    return [
      ...ranked,
      ...candidates.filter((candidate) => !picked.has(candidate.id)),
    ]
      .slice(0, PAGE_SIZE)
      .map((candidate) => recommendationCard(candidate));
  }

  async compatible(
    productId: string,
    direction: 'accessories' | 'fits',
    requestedPage = 1,
  ) {
    const anchor =
      direction === 'accessories'
        ? Prisma.sql`r."productId" = ${productId}`
        : Prisma.sql`r."accessoryId" = ${productId}`;
    const selectedId =
      direction === 'accessories' ? Prisma.sql`a."id"` : Prisma.sql`p."id"`;
    const selectedName =
      direction === 'accessories' ? Prisma.sql`a."name"` : Prisma.sql`p."name"`;
    const from = Prisma.sql`
      FROM "ProductCompatibility" r
      JOIN "Product" a ON a."id" = r."accessoryId"
      JOIN "Product" p ON p."id" = r."productId"
      WHERE ${anchor} AND r."ruleVersion" = ${COMPATIBILITY_RULE_VERSION}
        AND a."status" = 'PUBLISHED' AND p."status" = 'PUBLISHED'
        AND r."accessorySignature" = ${accessorySignatureSql('a')}
        AND r."productSignature" = ${targetSignatureSql('p')}`;
    // Plain statements, not an interactive transaction: a product page must
    // not hold a pooled connection across round trips. A link that goes stale
    // between them is dropped by the card read's status filter.
    const [count] = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total ${from}`;
    const pages = Math.ceil(count.total / PAGE_SIZE);
    const page = Math.min(Math.max(1, requestedPage), Math.max(1, pages));
    const ids = count.total
      ? await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT ${selectedId} AS id ${from}
          ORDER BY ${selectedName}, ${selectedId}
          LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`
      : [];
    const cards = ids.length
      ? await this.prisma.product.findMany({
          where: { id: { in: ids.map((row) => row.id) }, status: 'PUBLISHED' },
          select: RECOMMENDATION_CARD_SELECT,
        })
      : [];
    const byId = new Map(cards.map((card) => [card.id, card]));
    return {
      data: ids.flatMap(({ id }) => {
        const card = byId.get(id);
        return card ? [recommendationCard(card)] : [];
      }),
      pagination: { page, pages, total: count.total, limit: PAGE_SIZE },
    };
  }
}
