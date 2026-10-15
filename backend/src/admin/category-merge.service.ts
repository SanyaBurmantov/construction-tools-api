import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  findDuplicateSiblingGroups,
  sameCategoryName,
} from './category-duplicates';

type CategoryRow = {
  id: string;
  name: string;
  parentId: string | null;
  slug: string;
  level: number;
  path: string[];
};

type MergeIndex = {
  byId: Map<string, CategoryRow>;
  childrenByParent: Map<string, CategoryRow[]>;
};

type MergeCounts = {
  movedProducts: number;
  movedChildren: number;
  /** Same-named children folded into the target's own child. */
  mergedChildren: number;
};

/** An interactive transaction's default is 5 s; a deep merge moves a lot. */
const MERGE_TX_OPTIONS = { maxWait: 10_000, timeout: 120_000 };

@Injectable()
export class CategoryMergeService {
  constructor(private prisma: PrismaService) {}

  /**
   * Merge category `id` into `targetId`: move its products, re-point
   * supplier-category mappings, fold its specification definitions into the
   * target (keeping the target's values on conflicts), then delete it.
   *
   * Children are merged **deeply**: a child whose name the target already has
   * among its own children is merged into that child (recursively), and only
   * the rest are re-parented with rebuilt level/path/pathKey. Re-parenting
   * everything is what produced six «Двигатель» under one parent — every
   * nightly root merge put the moved branch's children next to the canonical
   * root's own.
   */
  async merge(id: string, targetId: string) {
    if (id === targetId) {
      throw new BadRequestException('Cannot merge a category into itself');
    }

    const index = await this.loadIndex();
    const source = index.byId.get(id);
    const target = index.byId.get(targetId);
    if (!source) throw new NotFoundException('Category not found');
    if (!target) throw new NotFoundException('Target category not found');

    if (this.subtreeIds(id, index).has(targetId)) {
      throw new BadRequestException(
        'Cannot merge a category into its own subcategory',
      );
    }

    const counts = await this.prisma.$transaction(async (tx) => {
      const totals: MergeCounts = {
        movedProducts: 0,
        movedChildren: 0,
        mergedChildren: 0,
      };
      await this.mergeInto(tx, source, target, index, totals, true);
      return totals;
    }, MERGE_TX_OPTIONS);

    return { ok: true, ...counts };
  }

  /**
   * Same-named sibling groups left in the tree, for the admin to review and
   * fold (`/admin/categories`, «Дубли»). Read-only.
   */
  async findDuplicates() {
    const [rows, counts] = await Promise.all([
      this.prisma.category.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          isVisible: true,
        },
      }),
      this.prisma.product.groupBy({
        by: ['categoryId'],
        where: { status: 'PUBLISHED' },
        _count: { _all: true },
      }),
    ]);
    const groups = findDuplicateSiblingGroups(
      rows,
      new Map(counts.map((row) => [row.categoryId, row._count._all])),
    );
    return {
      groups,
      totals: {
        groups: groups.length,
        /** Rows that would disappear if every group were folded. */
        redundantCategories: groups.reduce(
          (sum, group) => sum + group.categories.length - 1,
          0,
        ),
      },
    };
  }

  /**
   * Folds a reviewed duplicate group: every id in `sourceIds` into `targetId`.
   * Each source must be a sibling of the target with the same name — this
   * endpoint is for duplicates only; anything else goes through `merge()`.
   * Sources are merged one transaction each, so a failure leaves the earlier
   * ones done and reports which one stopped.
   */
  async mergeDuplicates(targetId: string, sourceIds: string[]) {
    const index = await this.loadIndex();
    const target = index.byId.get(targetId);
    if (!target) throw new NotFoundException('Target category not found');

    const ids = [...new Set(sourceIds)].filter((id) => id !== targetId);
    if (!ids.length) {
      throw new BadRequestException('Nothing to merge');
    }
    for (const id of ids) {
      const source = index.byId.get(id);
      if (!source) throw new NotFoundException(`Category ${id} not found`);
      if (
        source.parentId !== target.parentId ||
        !sameCategoryName(source.name, target.name)
      ) {
        throw new BadRequestException(
          `«${source.name}» (${source.slug}) is not a same-named sibling of «${target.name}»`,
        );
      }
    }

    const totals: MergeCounts & { merged: number } = {
      merged: 0,
      movedProducts: 0,
      movedChildren: 0,
      mergedChildren: 0,
    };
    for (const id of ids) {
      const result = await this.merge(id, targetId);
      totals.merged++;
      totals.movedProducts += result.movedProducts;
      totals.movedChildren += result.movedChildren;
      totals.mergedChildren += result.mergedChildren;
    }
    return { ok: true, ...totals };
  }

  private async loadIndex(): Promise<MergeIndex> {
    const categories: CategoryRow[] = await this.prisma.category.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
        slug: true,
        level: true,
        path: true,
      },
    });
    const byId = new Map(categories.map((row) => [row.id, row]));
    const childrenByParent = new Map<string, CategoryRow[]>();
    for (const row of categories) {
      if (!row.parentId) continue;
      const list = childrenByParent.get(row.parentId) ?? [];
      list.push(row);
      childrenByParent.set(row.parentId, list);
    }
    return { byId, childrenByParent };
  }

  private subtreeIds(id: string, index: MergeIndex): Set<string> {
    const ids = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const current = queue.shift() as string;
      if (ids.has(current)) continue;
      ids.add(current);
      for (const child of index.childrenByParent.get(current) ?? []) {
        queue.push(child.id);
      }
    }
    return ids;
  }

  private async mergeInto(
    tx: Prisma.TransactionClient,
    source: CategoryRow,
    target: CategoryRow,
    index: MergeIndex,
    totals: MergeCounts,
    top: boolean,
  ) {
    const movedProducts = await tx.product.updateMany({
      where: { categoryId: source.id },
      data: { categoryId: target.id },
    });
    totals.movedProducts += movedProducts.count;

    await tx.sourceCategory.updateMany({
      where: { mappedCategoryId: source.id },
      data: { mappedCategoryId: target.id },
    });

    await tx.pricingRule.updateMany({
      where: { categoryId: source.id },
      data: { categoryId: target.id },
    });
    await tx.categoryRedirect.updateMany({
      where: { categoryId: source.id },
      data: { categoryId: target.id },
    });
    await tx.categoryRedirect.upsert({
      where: { slug: source.slug },
      create: { slug: source.slug, categoryId: target.id },
      update: { categoryId: target.id },
    });

    await this.foldSpecifications(tx, source.id, target.id);

    const directChildren = [...(index.childrenByParent.get(source.id) ?? [])];
    for (const child of directChildren) {
      const targetChildren = index.childrenByParent.get(target.id) ?? [];
      const twin = targetChildren.find(
        (candidate) =>
          candidate.id !== child.id &&
          sameCategoryName(candidate.name, child.name),
      );
      if (twin) {
        await this.mergeInto(tx, child, twin, index, totals, false);
        totals.mergedChildren++;
        continue;
      }
      await this.reparentSubtree(tx, child, target, index.childrenByParent);
      // Keep the index truthful for the siblings still to come: a later
      // same-named child must find this one under the target.
      targetChildren.push(child);
      index.childrenByParent.set(target.id, targetChildren);
      if (top) totals.movedChildren++;
    }
    index.childrenByParent.delete(source.id);

    await tx.category.delete({ where: { id: source.id } });
  }

  /**
   * Specification keys are unique per category. Specs the target doesn't
   * have are moved over; for clashing keys, product values are re-pointed to
   * the target's spec (the target's own values win) and the duplicate spec
   * definition is dropped.
   */
  private async foldSpecifications(
    tx: Prisma.TransactionClient,
    sourceCategoryId: string,
    targetCategoryId: string,
  ) {
    const sourceSpecs = await tx.specification.findMany({
      where: { categoryId: sourceCategoryId },
    });

    for (const spec of sourceSpecs) {
      const targetSpec = await tx.specification.findUnique({
        where: {
          categoryId_key: { categoryId: targetCategoryId, key: spec.key },
        },
      });

      if (!targetSpec) {
        await tx.specification.update({
          where: { id: spec.id },
          data: { categoryId: targetCategoryId },
        });
        continue;
      }

      const taken = await tx.productSpecification.findMany({
        where: { specificationId: targetSpec.id },
        select: { productId: true },
      });
      await tx.productSpecification.deleteMany({
        where: {
          specificationId: spec.id,
          productId: { in: taken.map((row) => row.productId) },
        },
      });
      await tx.productSpecification.updateMany({
        where: { specificationId: spec.id },
        data: { specificationId: targetSpec.id },
      });
      await tx.specification.delete({ where: { id: spec.id } });
    }
  }

  /** Re-parent `child` under `newParent` and rebuild level/path below it. */
  private async reparentSubtree(
    tx: Prisma.TransactionClient,
    child: CategoryRow,
    newParent: CategoryRow,
    childrenByParent: Map<string, CategoryRow[]>,
  ) {
    const update = async (
      row: CategoryRow,
      parentPath: string[],
      parentLevel: number,
      parentId?: string,
    ) => {
      const path = [...parentPath, row.slug];
      const level = parentLevel + 1;
      await tx.category.update({
        where: { id: row.id },
        data: {
          ...(parentId ? { parentId } : {}),
          path,
          level,
          // pathKey is the parsers' identity for this category. Leaving it at
          // the pre-merge chain would make the next parse create a fresh row
          // at the old position — resurrecting the category an admin merged.
          pathKey: path.join('/'),
        },
      });
      // The in-memory index serves the rest of this merge (a later twin may
      // be this very row), so it must see the new position too.
      row.path = path;
      row.level = level;
      if (parentId) row.parentId = parentId;
      for (const next of childrenByParent.get(row.id) ?? []) {
        await update(next, path, level);
      }
    };

    await update(child, newParent.path, newParent.level, newParent.id);
  }
}
