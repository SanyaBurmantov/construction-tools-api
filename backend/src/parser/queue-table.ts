import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The four per-source queue tables share one shape. This is the one place
 * that maps a source code to its table, so recovery, claiming and stats stop
 * repeating the same four-way switch.
 */
const QUEUE_TABLES = {
  'th-tools': { delegate: 'sitemapsThTools', table: 'SitemapsThTools' },
  'tools-by': { delegate: 'sitemapsToolsBy', table: 'SitemapsToolsBy' },
  dukon: { delegate: 'sitemapsDukon', table: 'SitemapsDukon' },
} as const;

export type QueueSourceCode = keyof typeof QUEUE_TABLES;

/** The subset of a queue delegate the shared code uses. */
export type QueueTable = Pick<
  PrismaService['sitemapsThTools'],
  'updateMany' | 'count' | 'findMany' | 'update'
>;

export function queueTable(
  prisma: PrismaService,
  code: string,
): QueueTable | null {
  const entry = QUEUE_TABLES[code as QueueSourceCode];
  // The four delegates are structurally identical; Prisma's types simply do
  // not survive a dynamic lookup.
  return entry ? (prisma[entry.delegate] as unknown as QueueTable) : null;
}

/**
 * How long a claimed row is reserved for the worker that took it. Longer than
 * the slowest batch (300 URLs × delay), so a running batch never loses its
 * tail to a second claimer; short enough that a row claimed by a process that
 * died is picked up again within the hour.
 */
const CLAIM_LEASE_MINUTES = 60;

/**
 * Takes the next `limit` PENDING URLs of a source **for this worker only**.
 *
 * A plain `findMany(status = PENDING)` let a button press, a second process
 * or an overlapping run pick the very same rows, and two workers parsing one
 * offer is what produced duplicate products. `FOR UPDATE SKIP LOCKED` makes
 * concurrent claimers take disjoint rows; stamping `lastTriedAt` is the lease
 * that keeps a claimed row out of the next claim until it is processed (its
 * status then leaves PENDING) or the lease runs out.
 *
 * Order: never-seen URLs first, then the stalest snapshot.
 */
export async function claimQueueBatch(
  prisma: PrismaService,
  code: string,
  limit: number,
): Promise<Array<{ url: string }>> {
  const entry = QUEUE_TABLES[code as QueueSourceCode];
  if (!entry || limit <= 0) return [];
  const table = Prisma.raw(`"${entry.table}"`);

  return prisma.$queryRaw<Array<{ url: string }>>`
    UPDATE ${table} q
    SET "lastTriedAt" = NOW()
    FROM (
      SELECT "id" FROM ${table}
      WHERE "status" = 'PENDING'
        AND ("lastTriedAt" IS NULL
             OR "lastTriedAt" < NOW() - ${CLAIM_LEASE_MINUTES} * INTERVAL '1 minute')
      ORDER BY "visitedAt" ASC NULLS FIRST, "url" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) picked
    WHERE q."id" = picked."id"
    RETURNING q."url"
  `;
}
