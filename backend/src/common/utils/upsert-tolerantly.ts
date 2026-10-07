import { Prisma } from '@prisma/client';

/**
 * Retries an operation that lost a unique-constraint race.
 *
 * Prisma's `upsert` is only atomic when it can compile to `INSERT … ON CONFLICT`.
 * With a nested write, or on some composite keys, it degrades to read-then-write:
 * two workers in the same batch both see "no such row" and both insert, and the
 * loser gets `P2002`. Simply repeating the upsert fixes it — by then the row
 * exists, so the second attempt takes the update path.
 *
 * Use this for rows that several concurrent parses legitimately create at once:
 * the shared fallback category, the `Source` row, category tree nodes. Do NOT
 * use it to paper over a genuine duplicate — `ProductIdentityService` picks a
 * different slug instead, because there the second row is a different product.
 */
export async function upsertTolerantly<T>(
  operation: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= attempts - 1) throw error;
    }
  }
}

export function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
