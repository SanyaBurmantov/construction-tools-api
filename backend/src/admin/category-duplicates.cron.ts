import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CategoryMergeService } from './category-merge.service';

/** A bad night must not fold half the tree; the rest waits for tomorrow. */
const MAX_GROUPS_PER_NIGHT = 100;

/**
 * Folds same-named siblings every night — «Компрессоры» and «Компрессоры-2»
 * under one parent are one category by definition, and each copy was its own
 * thin page with its own URL. Uses the same deep merge as the «Дубли» view in
 * /admin/categories: products, children, aliases for the parser and a 301
 * from the old slug all move with it. The survivor is the group's suggested
 * target (biggest subtree, then the shortest — oldest — slug).
 *
 * A group whose copies differ in visibility is left alone: hiding one of them
 * was an admin's decision, and merging would undo it.
 */
@Injectable()
export class CategoryDuplicatesCron {
  private readonly logger = new Logger(CategoryDuplicatesCron.name);

  constructor(private readonly merge: CategoryMergeService) {}

  // 04:47 — after the 03:45 normalizer, clear of every parser slot.
  @Cron('0 47 4 * * *')
  async foldNightly() {
    await this.run().catch((error: unknown) =>
      this.logger.error(
        `Nightly duplicate fold failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  async run() {
    const { groups } = await this.merge.findDuplicates();
    let folded = 0;
    let skipped = 0;
    for (const group of groups.slice(0, MAX_GROUPS_PER_NIGHT)) {
      const visibility = new Set(group.categories.map((c) => c.isVisible));
      if (visibility.size > 1) {
        skipped++;
        continue;
      }
      const sources = group.categories
        .map((c) => c.id)
        .filter((id) => id !== group.targetId);
      try {
        await this.merge.mergeDuplicates(group.targetId, sources);
        folded += sources.length;
      } catch (error) {
        this.logger.warn(
          `Could not fold «${group.name}»: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (folded || skipped) {
      this.logger.log(
        `Folded ${folded} duplicate categories; ${skipped} group(s) left for an admin (mixed visibility)`,
      );
    }
    return { folded, skipped, groups: groups.length };
  }
}
