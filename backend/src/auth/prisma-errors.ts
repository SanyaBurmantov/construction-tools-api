import { Prisma } from '@prisma/client';

/**
 * A unique-constraint violation. Login uniqueness is pre-checked before the
 * insert, but two simultaneous requests can always overtake that check — this
 * turns the race into a 409 instead of a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
