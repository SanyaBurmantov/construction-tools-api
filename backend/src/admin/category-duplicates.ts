import { normalizeCategoryName } from '../parser/categories/taxonomy';

/**
 * Same-named siblings: two categories with the same name under the same
 * parent. Pure, so the grouping is testable without a database.
 *
 * Why they exist: the nightly normalizer merges a supplier root into its
 * canonical one, and `CategoryMergeService.merge()` used to re-parent the
 * children as they were — so «Специальный инструмент / Двигатель» landed next
 * to the «Двигатель» the canonical root already had. The parser then
 * re-created the supplier branch at its old `pathKey`, the next night merged it
 * again, and prod collected up to six «Двигатель» under one parent
 * (`…-dvigatel`, `…-dvigatel-2` … `-6`). Both causes are fixed (deep merge,
 * sibling reuse in `CategoryTreeService`); this finds what is left for an
 * admin to fold, one reviewed click per group.
 */

export type CategoryRowForDuplicates = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isVisible: boolean;
};

export type DuplicateCategory = {
  id: string;
  name: string;
  slug: string;
  isVisible: boolean;
  /** Published products in the category and its subtree. */
  productCount: number;
  /** Direct children. */
  childCount: number;
};

export type DuplicateGroup = {
  /** Shared normalized name. */
  key: string;
  name: string;
  parent: { id: string; name: string; slug: string } | null;
  /** Suggested survivor: biggest subtree, then the shortest (oldest) slug. */
  targetId: string;
  categories: DuplicateCategory[];
};

export function findDuplicateSiblingGroups(
  rows: CategoryRowForDuplicates[],
  /** Published products attached directly to each category id. */
  ownCounts: Map<string, number>,
): DuplicateGroup[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const childrenOf = new Map<string, CategoryRowForDuplicates[]>();
  for (const row of rows) {
    const key = row.parentId ?? '';
    const list = childrenOf.get(key) ?? [];
    list.push(row);
    childrenOf.set(key, list);
  }

  const subtreeCount = new Map<string, number>();
  const countSubtree = (id: string, guard: Set<string>): number => {
    const cached = subtreeCount.get(id);
    if (cached !== undefined) return cached;
    if (guard.has(id)) return 0;
    guard.add(id);
    const total =
      (ownCounts.get(id) ?? 0) +
      (childrenOf.get(id) ?? []).reduce(
        (sum, child) => sum + countSubtree(child.id, guard),
        0,
      );
    subtreeCount.set(id, total);
    return total;
  };

  const groups: DuplicateGroup[] = [];
  for (const [parentKey, siblings] of childrenOf) {
    const byName = new Map<string, CategoryRowForDuplicates[]>();
    for (const sibling of siblings) {
      const key = normalizeCategoryName(sibling.name);
      if (!key) continue;
      const list = byName.get(key) ?? [];
      list.push(sibling);
      byName.set(key, list);
    }

    for (const [key, members] of byName) {
      if (members.length < 2) continue;
      const categories = members
        .map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          isVisible: row.isVisible,
          productCount: countSubtree(row.id, new Set()),
          childCount: childrenOf.get(row.id)?.length ?? 0,
        }))
        .sort(
          (a, b) =>
            b.productCount - a.productCount ||
            a.slug.length - b.slug.length ||
            a.slug.localeCompare(b.slug),
        );
      const parent = parentKey ? byId.get(parentKey) : undefined;
      groups.push({
        key,
        name: categories[0].name,
        parent: parent
          ? { id: parent.id, name: parent.name, slug: parent.slug }
          : null,
        targetId: categories[0].id,
        categories,
      });
    }
  }

  // Biggest mess first: the groups a customer is most likely to run into.
  return groups.sort(
    (a, b) =>
      b.categories.reduce((sum, c) => sum + c.productCount, 0) -
        a.categories.reduce((sum, c) => sum + c.productCount, 0) ||
      a.name.localeCompare(b.name, 'ru'),
  );
}

/** Whether two category names are the same for sibling-merge purposes. */
export function sameCategoryName(a: string, b: string): boolean {
  const left = normalizeCategoryName(a);
  return Boolean(left) && left === normalizeCategoryName(b);
}
