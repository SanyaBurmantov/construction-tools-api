import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withoutPlaceholderImages } from '../../common/utils/product-images';
import { fitmentTitles, type FitmentRole } from './fitment';
import { packOptions, parsePack } from './packs';
import { MAX_FAMILY, productFamily, variantOptions } from './variants';
import { productKindStem, similarityScore } from './similarity';
import { nameSimilarity } from '../../offers/product-matching';
import {
  RECOMMENDATION_CARD_SELECT,
  SIMILARITY_SELECT,
  accessorySignatureSql,
  targetSignatureSql,
} from './relation-select';
import { RecommendationsQueryDto } from './recommendations.dto';

// A shelf on the product page: a dozen cards scroll sideways, more on demand.
const PAGE_SIZE = 12;
// Each candidate brings its specs: 120 of them per product page, times a
// cold-cache crawl after a deploy, ran the 256 MB API out of heap twice.
const CANDIDATE_LIMIT = 48;
/**
 * «Похожие» computed ahead (ProductSimilar). Bump the version whenever the
 * similarity rules change — every stored row is then recomputed.
 */
export const SIMILAR_RULE_VERSION = 2;
export const SIMILAR_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** More than a row, so products going off sale still leave a full one. */
const SIMILAR_STORED = 24;
type SimilarEntry = { id: string; tier: number };
/** A name with no kind joins «Похожие» only when it reads this much alike. */
const UNKNOWN_KIND_MIN_TITLE = 0.4;
/** Recommendations computed at once; the rest wait (bounded) or get a 503. */
// 6 while the API had a 256 MB heap; 448 MB since the RAM upgrade (02.11).
const MAX_RUNNING = 10;
const MAX_WAITING = 40;
/** SSR, the browser and crawlers ask for the same card within seconds. */
const DEFAULT_CACHE_MS = 120_000;
const CACHE_ENTRIES = 500;
const CART_SUGGESTIONS = 8;
const PACK_CANDIDATES = 200;
/** «(20 кг)» in a name — a weighed pack; a parameter, not SQL text. */
const BY_WEIGHT_SQL = '\\(\\s*[0-9.,]+\\s*кг';

/**
 * One row per item on a shelf: the same product from two suppliers, or listed
 * twice by one, is the same brand under the same name — the best copy (in
 * stock, cheapest) stands for it (audit 2026-10-30: «дубли в лентах»).
 */
const SAME_ITEM_COPY = Prisma.raw(`row_number() OVER (
  PARTITION BY coalesce(p."brandId", ''),
    lower(regexp_replace(btrim(p."name"), '\\s+', ' ', 'g'))
  ORDER BY (p."stockStatus" = 'in_stock') DESC NULLS LAST, p."priceValue", p."id")`);

/**
 * What a shelf puts first, beyond «in stock, own brand, complete card,
 * cheapest» — read from the names of the shelf (`u`) and of the anchor product.
 * `priority` is a list of ORDER BY terms ending in a comma (or empty); `mix`
 * groups the rows into kinds that take turns (a constant when they do not).
 */
export function shelfOrder(
  key: string,
  role: FitmentRole,
  anchorName: string,
): { priority: Prisma.Sql; mix: Prisma.Sql } {
  const type = key.slice(0, key.indexOf(':'));
  const none = { priority: Prisma.empty, mix: Prisma.sql`0` };
  if (type === 'thread') {
    // A stainless bolt takes stainless nuts, and a 20 kg box of bolts takes
    // nuts by weight, not a 10-piece zip bag.
    const stainless = /нерж|aisi/i.test(anchorName);
    const byWeight = /\(\s*[\d.,]+\s*кг/i.test(anchorName);
    const material = Prisma.sql`(u."name" ~* 'нерж|aisi') = ${stainless} DESC,
      (u."name" ~* ${BY_WEIGHT_SQL}) = ${byWeight} DESC,`;
    if (role !== 'PART') return { ...none, priority: material };
    // A bolt's set: the standard nut (DIN 934), washer (DIN 125) and spring
    // washer (DIN 127) first, the same coating as the bolt, taking turns.
    const zinc = /цинк/i.test(anchorName);
    return {
      priority: Prisma.sql`${material}
        (u."name" ~* 'din ?(934|125|127)|iso ?(4032|7089)|гровер') DESC,
        (u."name" ~* 'цинк') = ${zinc} DESC,`,
      mix: Prisma.sql`CASE
        WHEN u."name" ~* 'гровер|пружин|din ?127' THEN 3
        WHEN u."name" ~* 'шайб' THEN 2
        WHEN u."name" ~* 'гайк' THEN 1
        ELSE 4 END`,
    };
  }
  if (role !== 'PART') return none;
  if (type === 'battery') {
    // A «solo» tool needs power first: kits and batteries before chargers.
    return {
      ...none,
      priority: Prisma.sql`(u."name" ~* 'комплект|набор|стартов') DESC,
        (u."name" ~* '^\s*аккумулятор') DESC,`,
    };
  }
  if (type === 'hex' || type === 'slot') {
    // Sets first, then the bits everyone uses.
    return {
      ...none,
      priority: Prisma.sql`(u."name" ~* 'набор') DESC,
        (u."name" ~* 'ph ?2|pz ?2') DESC,`,
    };
  }
  if (type === 'drive' && /гайков[её]рт/i.test(anchorName)) {
    // An impact wrench cracks ordinary sockets: impact ones first.
    return { ...none, priority: Prisma.sql`(u."name" ~* 'ударн') DESC,` };
  }
  return none;
}
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

  private running = 0;
  /** `RECOMMENDATIONS_CACHE_MS` (0 = off, as the integration tests run). */
  private readonly cacheMs = Number(
    process.env.RECOMMENDATIONS_CACHE_MS ?? DEFAULT_CACHE_MS,
  );
  private readonly waiting: Array<() => void> = [];
  private readonly cache = new Map<
    string,
    { expires: number; value: Promise<unknown> }
  >();

  /**
   * The product page's recommendations, cached for two minutes and computed
   * at most MAX_RUNNING at a time: a cold-cache crawl after a deploy used to
   * pile requests up until the API's heap gave out. Over the queue bound the
   * answer is a quick 503 — the page renders, the block reloads client-side.
   */
  async get(
    slug: string,
    query: RecommendationsQueryDto,
  ): Promise<Awaited<ReturnType<RecommendationsService['compute']>>> {
    const key = `${slug}|${query.accessoriesPage ?? 1}|${query.fitsPage ?? 1}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expires > now)
      return hit.value as ReturnType<RecommendationsService['compute']>;
    const value = this.gated(() => this.compute(slug, query));
    if (!this.cacheMs) return value;
    this.cache.set(key, { expires: now + this.cacheMs, value });
    // A failure is not cached; the oldest entries go first.
    value.catch(() => this.cache.delete(key));
    const oldest = this.cache.keys().next().value as string | undefined;
    if (this.cache.size > CACHE_ENTRIES && oldest) this.cache.delete(oldest);
    return value;
  }

  private async gated<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_RUNNING) {
      if (this.waiting.length >= MAX_WAITING)
        throw new ServiceUnavailableException('Подборки временно недоступны');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running += 1;
    try {
      return await work();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }

  private async compute(slug: string, query: RecommendationsQueryDto) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: SIMILARITY_SELECT,
    });
    if (!product) throw new NotFoundException('Товар не найден');
    const family = this.familyRow(product);
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
      family.then((row) => this.similar(product, row.familyKey)),
      this.compatible(product.id, 'accessories', query.accessoriesPage),
      this.compatible(product.id, 'fits', query.fitsPage),
      groups('PART'),
      groups('TOOL'),
      family.then((row) => this.packs(product, row.keyName)),
      family.then((row) => this.variants(product, row)),
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
   * The product's line row: the worker's (keyed by the supplier's name, or
   * the admin's «Линейка»), else computed from the current card so a new or
   * just-edited card has its switch before the worker reaches it.
   */
  private async familyRow(product: SimilarityRow) {
    const [row, own] = await Promise.all([
      this.prisma.productFamily.findUnique({
        where: { productId: product.id },
      }),
      this.prisma.product.findUnique({
        where: { id: product.id },
        select: { variantLine: true, variantLabel: true },
      }),
    ]);
    if (row?.keyName) return { ...row, label: own?.variantLabel ?? null };
    const family = productFamily({ ...product, variantLine: own?.variantLine });
    return {
      ...family,
      manual: Boolean(own?.variantLine?.trim()) && Boolean(family.familyKey),
      label: own?.variantLabel ?? null,
    };
  }

  /** Other sizes of the same line (variants.ts). */
  private async variants(
    product: SimilarityRow,
    family: Awaited<ReturnType<RecommendationsService['familyRow']>>,
  ) {
    if (!family.familyKey) return [];
    const rows = await this.prisma.productFamily.findMany({
      where: {
        familyKey: family.familyKey,
        productId: { not: product.id },
        product: { status: 'PUBLISHED' },
      },
      select: {
        keyName: true,
        product: {
          select: {
            id: true,
            slug: true,
            priceValue: true,
            stockStatus: true,
            variantLabel: true,
          },
        },
      },
      take: MAX_FAMILY + 1,
    });
    return variantOptions(
      {
        id: product.id,
        slug: product.slug,
        name: family.keyName,
        priceValue: product.priceValue,
        stockStatus: product.stockStatus,
        label: family.label,
      },
      rows.map((row) => ({
        id: row.product.id,
        slug: row.product.slug,
        name: row.keyName || '',
        priceValue: row.product.priceValue,
        stockStatus: row.product.stockStatus,
        label: row.product.variantLabel,
      })),
      family.manual,
    );
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
    const shelf = shelfOrder(key, role, product.name ?? '');
    const uniq = Prisma.sql`
      WITH base AS (
        SELECT p."id", p."name", p."brandId", p."stockStatus",
          p."listingRank", p."priceValue",
          ${SAME_ITEM_COPY} AS copy
        FROM "ProductFitment" f JOIN "Product" p ON p."id" = f."productId"
        WHERE f."key" = ${key} AND f."role" = ${role}
          AND p."status" = 'PUBLISHED' AND p."priceValue" > 0
          AND p."id" <> ${product.id}
      ), u AS (SELECT * FROM base WHERE copy = 1)`;
    const [count] = await this.prisma.$queryRaw<Array<{ total: number }>>`
      ${uniq} SELECT count(*)::int AS total FROM u`;
    const pages = Math.ceil(count.total / PAGE_SIZE);
    const page = Math.min(Math.max(1, requestedPage), Math.max(1, pages));
    const order = Prisma.sql`${shelf.priority}
      (u."stockStatus" = 'in_stock') DESC NULLS LAST,
      coalesce(u."brandId" = ${product.brandId}, false) DESC,
      u."listingRank" DESC, u."priceValue", u."id"`;
    // A bolt's row alternates nut, washer, spring washer instead of twelve
    // nuts in a row: every kind's best first, then every kind's second…
    const ids = count.total
      ? await this.prisma.$queryRaw<Array<{ id: string }>>`
          ${uniq}, ranked AS (
            SELECT u."id", row_number() OVER (
              PARTITION BY ${shelf.mix} ORDER BY ${order}) AS turn,
              ${shelf.mix} AS mix_kind
            FROM u
          )
          SELECT r."id" FROM ranked r JOIN u ON u."id" = r."id"
          ORDER BY r."turn", r."mix_kind", ${order}
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

  /**
   * Other packs of the same item and their price per piece/kg (packs.ts),
   * read from each card's family name (the supplier's when AI rewrote ours).
   */
  private async packs(product: SimilarityRow, keyName: string) {
    const own = parsePack(keyName);
    if (!own) return [];
    const rows = await this.prisma.productFamily.findMany({
      where: {
        // Not the category: suppliers file a box and a bag of the same anchor
        // under different branches. Brand + the exact name prefix suffice.
        keyName: { startsWith: own.prefix.trim() },
        productId: { not: product.id },
        product: {
          status: 'PUBLISHED',
          brandId: product.brandId,
          priceValue: { gt: 0 },
        },
      },
      select: {
        keyName: true,
        product: {
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
        },
      },
      take: PACK_CANDIDATES,
    });
    const image = (images: Array<{ url: string; alt: string | null }>) =>
      withoutPlaceholderImages(images)[0]?.url ?? null;
    const shown = new Map<string, string>([[product.id, product.name]]);
    for (const row of rows) shown.set(row.product.id, row.product.name);
    return packOptions({ id: product.id, name: keyName }, [
      ...rows.map((row) => ({
        ...row.product,
        name: row.keyName,
        image: image(row.product.images),
      })),
      { ...product, name: keyName, image: image(product.images) },
    ]).map((option) => ({
      ...option,
      name: shown.get(option.id) ?? option.name,
    }));
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
   * «Похожие»: the same kind of item (productKind — «бирка», «перфоратор»),
   * closest first by title, specs, sizes, price and brand. The product's own
   * category first; when it holds fewer than a row, the same kind from the
   * rest of the catalogue (an item is often filed in a neighbouring branch).
   *
   * **Relevance over a full row** (owner, 2026-11-04): another kind of item
   * never fills the gaps. It used to — «the block never goes empty» — and 44%
   * of the cards shown were another kind: window handles beside key tags, a
   * heat gun beside an air freshener. A short row, or none (the storefront
   * hides an empty block), is honest. Only a name with no recognisable kind
   * («(1/2", 24 мм, L=38 мм)») falls back to the category's closest names,
   * and only when those really read alike.
   */
  private async similar(product: SimilarityRow, familyKey?: string | null) {
    return this.similarCards(
      product,
      await this.similarEntries(product, familyKey),
    );
  }

  /**
   * The ranked «Похожие» of a product: the stored row when it is usable
   * (same rule version, younger than SIMILAR_TTL_MS, newer than the
   * product's last text change), else computed now and stored — so the
   * worker's pass and every product view keep each other's work.
   */
  private async similarEntries(
    product: SimilarityRow,
    familyKey: string | null | undefined,
    options: { fresh?: boolean } = {},
  ): Promise<SimilarEntry[]> {
    if (!options.fresh) {
      const stored = await this.prisma.productSimilar.findUnique({
        where: { productId: product.id },
      });
      if (
        stored &&
        stored.ruleVersion === SIMILAR_RULE_VERSION &&
        Date.now() - stored.computedAt.getTime() < SIMILAR_TTL_MS &&
        stored.computedAt >= product.contentUpdatedAt
      ) {
        return stored.entries as SimilarEntry[];
      }
    }
    const entries = await this.computeSimilarEntries(product, familyKey);
    const data = {
      entries,
      ruleVersion: SIMILAR_RULE_VERSION,
      computedAt: new Date(),
    };
    // Storing is a bonus: a failure costs a recomputation next time.
    await this.prisma.productSimilar
      .upsert({
        where: { productId: product.id },
        create: { productId: product.id, ...data },
        update: data,
      })
      .catch(() => undefined);
    return entries;
  }

  /**
   * For the worker (SimilarRefreshService): recompute and store one
   * product's «Похожие». False when the product is gone or not on sale.
   */
  async refreshSimilar(productId: string): Promise<boolean> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: 'PUBLISHED' },
      select: SIMILARITY_SELECT,
    });
    if (!product) return false;
    const family = await this.familyRow(product);
    await this.similarEntries(product, family.familyKey, { fresh: true });
    return true;
  }

  /** The ranking itself — no availability, no cards (those are live). */
  private async computeSimilarEntries(
    product: SimilarityRow,
    familyKey?: string | null,
  ): Promise<SimilarEntry[]> {
    // Other sizes of the same line are the variant switch's job; here they
    // crowded out real alternatives (audit 2026-10-30).
    const otherLine = familyKey
      ? Prisma.sql`AND NOT EXISTS (
          SELECT 1 FROM "ProductFamily" pf
          WHERE pf."productId" = "Product"."id" AND pf."familyKey" = ${familyKey})`
      : Prisma.empty;
    const load = async (where: Prisma.Sql) => {
      const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Product"
        WHERE "status" = 'PUBLISHED' AND "id" <> ${product.id}
          AND "priceValue" > 0 ${otherLine} AND ${where}
        ORDER BY similarity("name", ${product.name}) DESC, "listingRank" DESC, "id"
        LIMIT ${CANDIDATE_LIMIT}`;
      if (!ids.length) return [];
      const rows = await this.prisma.product.findMany({
        where: { id: { in: ids.map((row) => row.id) } },
        select: SIMILARITY_SELECT,
      });
      const order = new Map(ids.map((row, index) => [row.id, index]));
      return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    };
    const rank = (
      candidates: Awaited<ReturnType<typeof load>>,
      anyCategory: boolean,
    ) =>
      candidates
        .map((candidate) => ({
          candidate,
          score: similarityScore(product, candidate, { anyCategory }),
        }))
        .filter(({ score }) => score > 0)
        .sort(
          (a, b) =>
            b.score - a.score || a.candidate.id.localeCompare(b.candidate.id),
        )
        .map(({ candidate }) => candidate);

    const own = await load(Prisma.sql`"categoryId" = ${product.categoryId}`);
    const kindStem = productKindStem(product);
    let tiers: Array<typeof own>;
    if (!kindStem) {
      // No kind to compare: the category's names that really read alike.
      tiers = [
        own.filter(
          (candidate) =>
            nameSimilarity(product.name, candidate.name) >=
            UNKNOWN_KIND_MIN_TITLE,
        ),
      ];
    } else {
      const sameKind = rank(own, false);
      tiers = [sameKind];
      if (sameKind.length < PAGE_SIZE) {
        const like = `%${kindStem.replace(/[\\%_]/g, '\\$&')}%`;
        const elsewhere = await load(
          Prisma.sql`"categoryId" <> ${product.categoryId} AND "name" ILIKE ${like}`,
        );
        tiers.push(rank(elsewhere, true));
      }
    }

    const seen = new Set<string>();
    return tiers
      .flatMap((tier, tierIndex) =>
        tier.map((candidate) => ({ id: candidate.id, tier: tierIndex })),
      )
      .filter(({ id }) => (seen.has(id) ? false : (seen.add(id), true)))
      .slice(0, SIMILAR_STORED);
  }

  /**
   * Live cards for stored entries: only what is on sale with a price right
   * now, in stock first, then — for a cordless tool — the same battery
   * platform: an alternative the buyer's batteries do not fit is a lesser
   * one. Within a tier only: availability never lifts a less similar item
   * over a more similar one from a better tier.
   */
  private async similarCards(product: SimilarityRow, entries: SimilarEntry[]) {
    if (!entries.length) return [];
    const rows = await this.prisma.product.findMany({
      where: {
        id: { in: entries.map((entry) => entry.id) },
        status: 'PUBLISHED',
        priceValue: { gt: 0 },
      },
      select: RECOMMENDATION_CARD_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = entries
      .map((entry, index) => ({ ...entry, index, card: byId.get(entry.id) }))
      .filter(
        (entry): entry is typeof entry & { card: (typeof rows)[number] } =>
          entry.card !== undefined,
      );
    const platforms = await this.prisma.productFitment.findMany({
      where: {
        productId: { in: [product.id, ...ordered.map((c) => c.id)] },
        key: { startsWith: 'battery:' },
      },
      select: { productId: true, key: true },
    });
    const ownPlatforms = new Set(
      platforms.filter((t) => t.productId === product.id).map((t) => t.key),
    );
    const samePlatform = new Set(
      platforms
        .filter((t) => t.productId !== product.id && ownPlatforms.has(t.key))
        .map((t) => t.productId),
    );
    const availability = (entry: (typeof ordered)[number]) =>
      (entry.card.stockStatus === 'in_stock' ? 0 : 2) +
      (ownPlatforms.size && !samePlatform.has(entry.id) ? 1 : 0);
    return ordered
      .sort(
        (a, b) =>
          a.tier - b.tier ||
          availability(a) - availability(b) ||
          a.index - b.index,
      )
      .slice(0, PAGE_SIZE)
      .map(({ card }) => recommendationCard(card));
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
    const selected = direction === 'accessories' ? 'a' : 'p';
    const column = (name: string) => Prisma.raw(`${selected}."${name}"`);
    // One row per item (the same accessory from two suppliers is one), in
    // stock first, then by name: the shelf used to be alphabetical, with the
    // unavailable copies interleaved (audit 2026-10-30).
    const uniq = Prisma.sql`
      WITH base AS (
        SELECT ${selectedId} AS id, ${column('name')} AS name,
          ${column('stockStatus')} AS "stockStatus",
          row_number() OVER (
            PARTITION BY coalesce(${column('brandId')}, ''),
              lower(regexp_replace(btrim(${column('name')}), '\s+', ' ', 'g'))
            ORDER BY (${column('stockStatus')} = 'in_stock') DESC NULLS LAST,
              ${column('priceValue')}, ${selectedId}) AS copy
        FROM "ProductCompatibility" r
        JOIN "Product" a ON a."id" = r."accessoryId"
        JOIN "Product" p ON p."id" = r."productId"
        WHERE ${anchor}
          AND a."status" = 'PUBLISHED' AND p."status" = 'PUBLISHED'
          AND r."accessorySignature" = ${accessorySignatureSql('a')}
          AND r."productSignature" = ${targetSignatureSql('p')}
      ), u AS (SELECT * FROM base WHERE copy = 1)`;
    // Plain statements, not an interactive transaction: a product page must
    // not hold a pooled connection across round trips. A link that goes stale
    // between them is dropped by the card read's status filter.
    const [count] = await this.prisma.$queryRaw<Array<{ total: number }>>`
      ${uniq} SELECT count(*)::int AS total FROM u`;
    const pages = Math.ceil(count.total / PAGE_SIZE);
    const page = Math.min(Math.max(1, requestedPage), Math.max(1, pages));
    const ids = count.total
      ? await this.prisma.$queryRaw<Array<{ id: string }>>`
          ${uniq} SELECT u."id" FROM u
          ORDER BY (u."stockStatus" = 'in_stock') DESC NULLS LAST, u."name", u."id"
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
