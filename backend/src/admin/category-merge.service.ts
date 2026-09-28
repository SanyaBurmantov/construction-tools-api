import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CategoryRow = {
  id: string;
  parentId: string | null;
  slug: string;
  level: number;
  path: string[];
};

@Injectable()
export class CategoryMergeService {
  constructor(private prisma: PrismaService) {}

  /**
   * Merge category `id` into `targetId`: move its products, re-point
   * supplier-category mappings, fold its specification definitions into the
   * target (keeping the target's values on conflicts), re-parent its
   * children under the target (rebuilding level/path), then delete it.
   */
  async merge(id: string, targetId: string) {
    if (id === targetId) {
      throw new BadRequestException('Cannot merge a category into itself');
    }

    const categories: CategoryRow[] = await this.prisma.category.findMany({
      select: { id: true, parentId: true, slug: true, level: true, path: true },
    });
    const byId = new Map(categories.map((row) => [row.id, row]));
    const source = byId.get(id);
    const target = byId.get(targetId);
    if (!source) throw new NotFoundException('Category not found');
    if (!target) throw new NotFoundException('Target category not found');

    const childrenByParent = new Map<string, CategoryRow[]>();
    for (const row of categories) {
      if (!row.parentId) continue;
      const list = childrenByParent.get(row.parentId) ?? [];
      list.push(row);
      childrenByParent.set(row.parentId, list);
    }

    const subtreeIds = new Set<string>();
    const queue = [source.id];
    while (queue.length) {
      const current = queue.shift() as string;
      subtreeIds.add(current);
      for (const child of childrenByParent.get(current) ?? []) {
        queue.push(child.id);
      }
    }
    if (subtreeIds.has(targetId)) {
      throw new BadRequestException(
        'Cannot merge a category into its own subcategory',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const movedProducts = await tx.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: targetId },
      });

      await tx.sourceCategory.updateMany({
        where: { mappedCategoryId: id },
        data: { mappedCategoryId: targetId },
      });

      await this.foldSpecifications(tx, id, targetId);

      const directChildren = childrenByParent.get(id) ?? [];
      for (const child of directChildren) {
        await this.reparentSubtree(tx, child, target, childrenByParent);
      }

      await tx.category.delete({ where: { id } });

      return {
        ok: true,
        movedProducts: movedProducts.count,
        movedChildren: directChildren.length,
      };
    });
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
        data: { ...(parentId ? { parentId } : {}), path, level },
      });
      for (const next of childrenByParent.get(row.id) ?? []) {
        await update(next, path, level);
      }
    };

    await update(child, newParent.path, newParent.level, newParent.id);
  }
}
