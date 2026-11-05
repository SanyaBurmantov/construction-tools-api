/**
 * The shop's own trade versus what came along with the suppliers.
 *
 * Since 2026-11-05 every supplier category is imported (cosmetics, household
 * goods, garden…) — people may order anything. But the home page is the
 * shop window of a tool and equipment supplier for organisations: its
 * automatic rows («Популярное у организаций», «Новинки») leave these
 * departments out, or the first thing a buyer saw was enamel saucepans and a
 * toilet bucket from the latest import. Root names, as in the catalogue.
 */
export const NON_CORE_ROOT_NAMES = [
  'Косметика, уход',
  'Хозтовары',
  'Товары для дома',
  'Дача, отдых и развлечения',
  'Велотехника',
  'Автохимия и автокосметика',
  'Неразобранные товары поставщиков',
];

type CategoryLink = { id: string; parentId: string | null; name: string };

/** The root of every category (by `parentId`, cycle-safe). */
export function rootsOf(rows: CategoryLink[]): Map<string, CategoryLink> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const roots = new Map<string, CategoryLink>();
  for (const row of rows) {
    let node = row;
    const seen = new Set<string>();
    while (node.parentId && byId.has(node.parentId) && !seen.has(node.id)) {
      seen.add(node.id);
      node = byId.get(node.parentId)!;
    }
    roots.set(row.id, node);
  }
  return roots;
}

/** Ids of every category under a non-core root, the roots included. */
export function nonCoreCategoryIds(rows: CategoryLink[]): string[] {
  const excluded = new Set(NON_CORE_ROOT_NAMES);
  const roots = rootsOf(rows);
  return rows
    .filter((row) => excluded.has(roots.get(row.id)!.name))
    .map((row) => row.id);
}
