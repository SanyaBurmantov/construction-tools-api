import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * `Category.pathKey` is the parsers' identity for a category: the slug chain
 * of the supplier's breadcrumbs. Anything that moves, re-slugs or merges a
 * category rewrites that key — and the next parse of the old breadcrumbs used
 * to find nothing there and recreate the branch at the supplier's position,
 * pulling its products back (the «six Двигатель» problem).
 *
 * These helpers keep the old key resolvable through `CategoryPathAlias`,
 * which `CategoryTreeService.upsertBranch()` consults first.
 */

/**
 * Writes the new identity of one category and remembers the old one.
 * Refuses a key that already belongs to another category — the unique index
 * would otherwise fail the whole move with a 500.
 */
export async function rekeyCategory(
  tx: Prisma.TransactionClient,
  categoryId: string,
  oldPathKey: string,
  newPathKey: string,
  data: Omit<Prisma.CategoryUncheckedUpdateInput, 'pathKey'> = {},
) {
  if (oldPathKey !== newPathKey) {
    const clash = await tx.category.findUnique({
      where: { pathKey: newPathKey },
      select: { id: true, name: true },
    });
    if (clash && clash.id !== categoryId) {
      throw new ConflictException(
        `Путь «${newPathKey}» уже занят категорией «${clash.name}» — переименуйте одну из них`,
      );
    }
  }

  await tx.category.update({
    where: { id: categoryId },
    data: { ...data, pathKey: newPathKey },
  });

  if (oldPathKey === newPathKey) return;
  // The category now owns this key outright; an alias with the same key
  // (left by an earlier move) would shadow it.
  await tx.categoryPathAlias.deleteMany({ where: { pathKey: newPathKey } });
  await tx.categoryPathAlias.upsert({
    where: { pathKey: oldPathKey },
    create: { pathKey: oldPathKey, categoryId },
    update: { categoryId },
  });
}

/**
 * Before `source` is deleted in a merge: its own key and every alias that
 * pointed at it now resolve to `target`. Must run before the delete — aliases
 * cascade with their category.
 */
export async function moveCategoryAliases(
  tx: Prisma.TransactionClient,
  source: { id: string; pathKey: string },
  targetId: string,
) {
  await tx.categoryPathAlias.updateMany({
    where: { categoryId: source.id },
    data: { categoryId: targetId },
  });
  await tx.categoryPathAlias.upsert({
    where: { pathKey: source.pathKey },
    create: { pathKey: source.pathKey, categoryId: targetId },
    update: { categoryId: targetId },
  });
}
