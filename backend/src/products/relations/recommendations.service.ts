import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withoutPlaceholderImages } from '../../common/utils/product-images';
import { COMPATIBILITY_RULE_VERSION } from './compatibility';
import { productKind, similarityScore } from './similarity';
import {
  RECOMMENDATION_CARD_SELECT,
  SIMILARITY_SELECT,
  signatureSql,
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

  private async similar(product: SimilarityRow) {
    const kind = productKind(product);
    if (!kind) return [];
    const candidates = await this.prisma.product.findMany({
      where: {
        id: { not: product.id },
        status: 'PUBLISHED',
        categoryId: product.categoryId,
        priceValue: { gt: 0 },
      },
      orderBy: [{ listingRank: 'desc' }, { id: 'asc' }],
      take: CANDIDATE_LIMIT,
      select: SIMILARITY_SELECT,
    });
    return candidates
      .map((candidate) => ({
        candidate,
        score: similarityScore(product, candidate),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.candidate.id.localeCompare(b.candidate.id),
      )
      .slice(0, PAGE_SIZE)
      .map(({ candidate }) => recommendationCard(candidate));
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
        AND r."accessorySignature" = ${signatureSql('a')}
        AND r."productSignature" = ${signatureSql('p')}
        AND NOT EXISTS (
          SELECT 1 FROM "Product" other
          WHERE other."brandId" = p."brandId" AND other."status" = 'PUBLISHED'
            AND other."id" <> p."id" AND other."id" <> a."id"
            AND (
              regexp_replace(upper(other."model"), '[[:space:]‐‑–—_-]', '', 'g') = r."modelCode"
              OR regexp_replace(upper(other."sku"), '[[:space:]‐‑–—_-]', '', 'g') = r."modelCode"
            )
        )`;
    // Count, validation and card reads share a snapshot: neither stale links
    // nor hidden products may slip in between the queries.
    return this.prisma.$transaction(
      async (tx) => {
        const [count] = await tx.$queryRaw<Array<{ total: number }>>`
        SELECT count(*)::int AS total ${from}`;
        const pages = Math.ceil(count.total / PAGE_SIZE);
        const page = Math.min(Math.max(1, requestedPage), Math.max(1, pages));
        const ids = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT ${selectedId} AS id ${from}
        ORDER BY ${selectedName}, ${selectedId}
        LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`;
        const cards = ids.length
          ? await tx.product.findMany({
              where: {
                id: { in: ids.map((row) => row.id) },
                status: 'PUBLISHED',
              },
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
