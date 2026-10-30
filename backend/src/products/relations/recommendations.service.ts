import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withoutPlaceholderImages } from '../../common/utils/product-images';
import { fitmentTitles, type FitmentRole } from './fitment';
import { packOptions, parsePack } from './packs';
import { MAX_FAMILY, familyKey, variantOptions } from './variants';
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
const CART_SUGGESTIONS = 8;
const PACK_CANDIDATES = 200;
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
    const tags = await this.prisma.productFitment.findMany({
      where: { productId: product.id },
      select: { key: true, role: true },
      orderBy: { key: 'asc' },
    });
    const groups = (role: FitmentRole) =>
      Promise.all(
        tags
          // A tool lists the parts it takes; a part, the tools it fits.
          .filter((tag) => tag.role !== role)
          .map((tag) => this.fitmentGroup(product, tag.key, role, 1)),
      );
    const [
      similar,
      accessories,
      fits,
      consumables,
      compatibleTools,
      packs,
      variants,
    ] = await Promise.all([
      this.similar(product),
      this.compatible(product.id, 'accessories', query.accessoriesPage),
      this.compatible(product.id, 'fits', query.fitsPage),
      groups('PART'),
      groups('TOOL'),
      this.packs(product),
      this.variants(product),
    ]);
    return {
      similar,
      accessories,
      fits,
      consumables: consumables.filter((group) => group.pagination.total),
      compatibleTools: compatibleTools.filter(
        (group) => group.pagination.total,
      ),
      packs,
      variants,
    };
  }

  /**
   * Other sizes of the same line (variants.ts). The key is computed from the
   * current name, so a renamed card finds its family before the worker has
   * re-read it; members come from the worker's table.
   */
  private async variants(product: SimilarityRow) {
    const key = familyKey(product.name, product.brandId, product.categoryId);
    if (!key) return [];
    const members = await this.prisma.product.findMany({
      where: {
        status: 'PUBLISHED',
        id: { not: product.id },
        family: { familyKey: key },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        priceValue: true,
        priceCurrency: true,
        stockStatus: true,
      },
      take: MAX_FAMILY + 1,
    });
    return variantOptions(product, members);
  }

  /** One page of one standard-fit group, for paging it on its own. */
  async group(slug: string, key: string, role: FitmentRole, page: number) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: { id: true, brandId: true, name: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    // Only a group the product actually has: no catalogue browsing by key.
    const own = await this.prisma.productFitment.findFirst({
      where: {
        productId: product.id,
        key,
        role: role === 'PART' ? 'TOOL' : 'PART',
      },
    });
    if (!own) throw new NotFoundException('Подборка не найдена');
    return this.fitmentGroup(product, key, role, page);
  }

  /**
   * Products of `role` sharing `key`: in stock first, the product's own brand
   * next, then the catalogue's complete cards, cheapest first — a consumable
   * is bought by price (cutting discs before diamond ones).
   */
  private async fitmentGroup(
    product: { id: string; brandId: string | null; name?: string },
    key: string,
    role: FitmentRole,
    requestedPage: number,
  ) {
    // A stainless bolt takes stainless nuts: the same material first.
    const stainless = /нерж|aisi/i.test(product.name ?? '');
    const material = key.startsWith('thread:')
      ? Prisma.sql`(p."name" ~* 'нерж|aisi') = ${stainless} DESC,`
      : Prisma.empty;
    const from = Prisma.sql`
      FROM "ProductFitment" f JOIN "Product" p ON p."id" = f."productId"
      WHERE f."key" = ${key} AND f."role" = ${role}
        AND p."status" = 'PUBLISHED' AND p."priceValue" > 0
        AND p."id" <> ${product.id}`;
    const [count] = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total ${from}`;
    const pages = Math.ceil(count.total / PAGE_SIZE);
    const page = Math.min(Math.max(1, requestedPage), Math.max(1, pages));
    const ids = count.total
      ? await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT p."id" ${from}
          ORDER BY ${material} (p."stockStatus" = 'in_stock') DESC NULLS LAST,
            coalesce(p."brandId" = ${product.brandId}, false) DESC,
            p."listingRank" DESC, p."priceValue", p."id"
          LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`
      : [];
    const titles = fitmentTitles(key);
    return {
      key,
      role,
      title: role === 'PART' ? titles.parts : titles.tools,
      data: await this.cards(ids.map((row) => row.id)),
      pagination: { page, pages, total: count.total, limit: PAGE_SIZE },
    };
  }

  /** Cards in the given order, unpublished ones dropped. */
  private async cards(ids: string[]) {
    if (!ids.length) return [];
    const cards = await this.prisma.product.findMany({
      where: { id: { in: ids }, status: 'PUBLISHED' },
      select: RECOMMENDATION_CARD_SELECT,
    });
    const byId = new Map(cards.map((card) => [card.id, card]));
    return ids.flatMap((id) => {
      const card = byId.get(id);
      return card ? [recommendationCard(card)] : [];
    });
  }

  /** Other packs of the same item and their price per piece/kg (packs.ts). */
  private async packs(product: SimilarityRow) {
    const own = parsePack(product.name);
    if (!own) return [];
    const candidates = await this.prisma.product.findMany({
      where: {
        status: 'PUBLISHED',
        // Not the category: suppliers file a box and a bag of the same anchor
        // under different branches. Brand + the exact name prefix suffice.
        brandId: product.brandId,
        name: { startsWith: own.prefix.trim() },
        priceValue: { gt: 0 },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        priceValue: true,
        priceCurrency: true,
        stockStatus: true,
        images: {
          orderBy: { order: 'asc' },
          take: 2,
          select: { url: true, alt: true },
        },
      },
      take: PACK_CANDIDATES,
    });
    const image = (images: Array<{ url: string; alt: string | null }>) =>
      withoutPlaceholderImages(images)[0]?.url ?? null;
    return packOptions(product, [
      ...candidates
        .filter((candidate) => candidate.id !== product.id)
        .map((candidate) => ({ ...candidate, image: image(candidate.images) })),
      { ...product, image: image(product.images) },
    ]);
  }

  /**
   * «Не забудьте к заказу» for a cart: the accessories stated for its tools,
   * then the consumables its tools take by standard — taken in turns, so one
   * tool with forty accessories does not fill the whole row.
   */
  async forCart(productIds: string[]) {
    const ids = [...new Set(productIds)].slice(0, 50);
    if (!ids.length) return { data: [] };
    const inCart = Prisma.join(ids);
    // At most 5 per tool before the turns: one tool with forty accessories
    // must not crowd the others out of the query.
    const stated = await this.prisma.$queryRaw<
      Array<{ id: string; forName: string }>
    >`
      SELECT "id", "forName" FROM (
        SELECT a."id", p."name" AS "forName", row_number() OVER (
          PARTITION BY r."productId"
          ORDER BY (a."stockStatus" = 'in_stock') DESC NULLS LAST,
            a."listingRank" DESC, a."name"
        ) AS "rank"
        FROM "ProductCompatibility" r
        JOIN "Product" a ON a."id" = r."accessoryId"
        JOIN "Product" p ON p."id" = r."productId"
        WHERE r."productId" IN (${inCart}) AND a."id" NOT IN (${inCart})
          AND a."status" = 'PUBLISHED' AND p."status" = 'PUBLISHED'
          AND a."priceValue" > 0
          AND r."accessorySignature" = ${accessorySignatureSql('a')}
          AND r."productSignature" = ${targetSignatureSql('p')}
      ) ranked
      WHERE "rank" <= 5
      ORDER BY "rank", "forName"`;
    const tools = await this.prisma.productFitment.findMany({
      where: {
        productId: { in: ids },
        role: 'TOOL',
        product: { status: 'PUBLISHED' },
      },
      select: { key: true, product: { select: { brandId: true } } },
      distinct: ['key'],
      take: 6,
    });
    const byStandard = await Promise.all(
      tools.map(async ({ key, product }) => {
        const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT p."id"
          FROM "ProductFitment" f JOIN "Product" p ON p."id" = f."productId"
          WHERE f."key" = ${key} AND f."role" = 'PART'
            AND p."status" = 'PUBLISHED' AND p."priceValue" > 0
            AND p."id" NOT IN (${inCart})
          ORDER BY (p."stockStatus" = 'in_stock') DESC NULLS LAST,
            coalesce(p."brandId" = ${product.brandId}, false) DESC,
            p."listingRank" DESC, p."priceValue", p."id"
          LIMIT 3`;
        return {
          reason: fitmentTitles(key).parts,
          ids: rows.map((row) => row.id),
        };
      }),
    );
    // Queues per reason, drained in turns.
    const queues = new Map<string, string[]>();
    for (const row of stated) {
      const reason = `К «${row.forName.length > 60 ? `${row.forName.slice(0, 57)}…` : row.forName}»`;
      queues.set(reason, [...(queues.get(reason) ?? []), row.id]);
    }
    for (const group of byStandard)
      if (group.ids.length) queues.set(group.reason, group.ids);
    const picked = new Map<string, string>();
    while (
      picked.size < CART_SUGGESTIONS &&
      [...queues.values()].some((q) => q.length)
    ) {
      for (const [reason, queue] of queues) {
        const next = queue.shift();
        if (next && !picked.has(next)) picked.set(next, reason);
        if (picked.size >= CART_SUGGESTIONS) break;
      }
    }
    const cards = await this.cards([...picked.keys()]);
    return {
      data: cards.map((product) => ({
        reason: picked.get(product.id)!,
        product,
      })),
    };
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
      WHERE ${anchor}
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
