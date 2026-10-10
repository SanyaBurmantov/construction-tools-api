import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * "How many products are missing X" — asked as a SQL anti-join instead of
 * Prisma's `{ none: {} }`.
 *
 * Prisma renders `none` as `id NOT IN (SELECT "productId" FROM …)`, a shape
 * Postgres will not convert into an anti-join. With 147k `ProductImage` rows
 * and `work_mem` at 4 MB the id list does not fit in a hash, so the planner
 * falls back to Materialize + rescan — once per candidate product. The
 * "товары без картинок" counter on `/admin/stats` measured **13 minutes** that
 * way, with both cores pinned; written as `NOT EXISTS` the same question is a
 * Parallel Hash Anti Join answering in ~0.2s.
 *
 * That stall is what took the admin panel down: the gate called
 * `/admin/stats`, each reload queued another copy, and the Prisma pool was
 * exhausted until even `/auth/login` timed out. So these must stay raw —
 * switching any of them back to `{ none: {} }` re-creates the outage.
 */

export type ProductRef = { id: string; name: string; slug: string };

/** Products the storefront actually shows. */
export const PUBLISHED = Prisma.sql`p."status" = 'PUBLISHED'::"ProductStatus"`;

export const NO_IMAGES = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM "ProductImage" i WHERE i."productId" = p."id"
)`;

export const NO_SPECS = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM "ProductSpecification" ps WHERE ps."productId" = p."id"
)`;

/** Products carried by one supplier. */
export const fromSource = (sourceId: string) => Prisma.sql`EXISTS (
  SELECT 1 FROM "SourceProduct" sp
  WHERE sp."productId" = p."id" AND sp."sourceId" = ${sourceId}
)`;

/** Has supplier links, but none of them synced since `cutoff`. */
export const staleOffers = (cutoff: Date) => Prisma.sql`EXISTS (
  SELECT 1 FROM "SourceProduct" sp WHERE sp."productId" = p."id"
) AND NOT EXISTS (
  SELECT 1 FROM "SourceProduct" sp
  WHERE sp."productId" = p."id" AND sp."lastSync" >= ${cutoff}
)`;

const and = (conditions: Prisma.Sql[]) => Prisma.join(conditions, ' AND ');

export async function countProducts(
  prisma: PrismaService,
  ...conditions: Prisma.Sql[]
): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*) AS count FROM "Product" p WHERE ${and(conditions)}
  `);
  // Postgres count() is bigint; Prisma hands it back as a BigInt, which
  // JSON.stringify refuses to serialise.
  return Number(row?.count ?? 0);
}

export function sampleProducts(
  prisma: PrismaService,
  limit: number,
  ...conditions: Prisma.Sql[]
): Promise<ProductRef[]> {
  return prisma.$queryRaw<ProductRef[]>(Prisma.sql`
    SELECT p."id", p."name", p."slug"
    FROM "Product" p
    WHERE ${and(conditions)}
    LIMIT ${limit}
  `);
}
