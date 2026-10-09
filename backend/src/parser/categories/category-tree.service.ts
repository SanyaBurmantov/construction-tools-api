import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { generateSlug } from '../../common/utils/generate-slug';
import {
  categoryPathKey,
  categorySlugCandidates,
  numberedSlug,
} from './category-slug';

/** Guard against an unbounded loop if a slug family is exhausted. */
const MAX_SLUG_ATTEMPTS = 50;

export type UpsertedCategory = {
  id: string;
  slug: string;
  pathKey: string;
};

/**
 * Builds the canonical `Category` tree from a breadcrumb chain.
 *
 * Every parser used to do this inline with `upsert({ where: { slug } })`, where
 * the slug came from the leaf name only — so any two branches ending in the same
 * word ("Прочее", "Аксессуары") collapsed into one category and the first branch
 * to parse won the parent. Identity is now `pathKey`, the full slug chain; the
 * slug is only the public URL and is resolved so it stays unique.
 */
@Injectable()
export class CategoryTreeService {
  private readonly logger = new Logger(CategoryTreeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upserts every level of a breadcrumb chain and returns the leaf. Returns
   * null when the chain has no usable names (nothing to attach a product to —
   * the caller falls back to its "unsorted" category).
   */
  async upsertBranch(breadcrumbs: string[]): Promise<UpsertedCategory | null> {
    const pathSlugs: string[] = [];
    let parentId: string | null = null;
    let leaf: UpsertedCategory | null = null;

    for (const name of breadcrumbs.filter(
      (name) => !['главная', 'каталог'].includes(name.trim().toLowerCase()),
    )) {
      const slug = generateSlug(name);
      if (!slug) continue;

      pathSlugs.push(slug);
      leaf = await this.upsertLevel(name, [...pathSlugs], parentId);
      parentId = leaf.id;
    }

    return leaf;
  }

  private async upsertLevel(
    name: string,
    pathSlugs: string[],
    parentId: string | null,
  ): Promise<UpsertedCategory> {
    const pathKey = categoryPathKey(pathSlugs);

    const existing = await this.prisma.category.findUnique({
      where: { pathKey },
      select: { id: true, slug: true, parentId: true, level: true },
    });

    if (existing) {
      // Repair rows written before this service existed: the old code passed
      // `update: {}`, so a category that first appeared under the wrong parent
      // kept the wrong parent and level forever. The slug is deliberately left
      // alone — it is a public URL.
      const needsRepair =
        existing.parentId !== parentId ||
        existing.level !== pathSlugs.length - 1;

      if (needsRepair) {
        await this.prisma.category.update({
          where: { id: existing.id },
          data: { parentId, level: pathSlugs.length - 1, path: pathSlugs },
        });
      }

      return { id: existing.id, slug: existing.slug, pathKey };
    }

    return this.createWithFreeSlug(name, pathSlugs, parentId, pathKey);
  }

  private async createWithFreeSlug(
    name: string,
    pathSlugs: string[],
    parentId: string | null,
    pathKey: string,
  ): Promise<UpsertedCategory> {
    const candidates = categorySlugCandidates(pathSlugs);
    const fallbackBase = candidates[candidates.length - 1] ?? pathKey;

    for (let attempt = 0; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const slug =
        attempt < candidates.length
          ? candidates[attempt]
          : numberedSlug(fallbackBase, attempt - candidates.length + 2);

      // A merged category's old address belongs to its redirect permanently.
      const alias = await this.prisma.categoryRedirect.findUnique({
        where: { slug },
        select: { slug: true },
      });
      if (alias) continue;

      try {
        const created = await this.prisma.category.create({
          data: {
            name,
            slug,
            pathKey,
            parentId,
            level: pathSlugs.length - 1,
            path: pathSlugs,
            seoTitle: name,
            seoDescription: name,
          },
          select: { id: true, slug: true },
        });

        if (attempt > 0) {
          this.logger.log(
            `Category "${name}" (${pathKey}) took slug "${slug}" — "${candidates[0]}" belongs to another branch`,
          );
        }

        return { id: created.id, slug: created.slug, pathKey };
      } catch (error) {
        const target = this.uniqueViolationTarget(error);
        if (!target) throw error;

        // Another parser created this exact category between our findUnique and
        // this create — use theirs rather than inventing a duplicate.
        if (target.includes('pathKey')) {
          const raced = await this.prisma.category.findUnique({
            where: { pathKey },
            select: { id: true, slug: true },
          });
          if (raced) return { ...raced, pathKey };
        }

        // Slug taken: fall through to the next candidate.
      }
    }

    throw new Error(`Could not find a free slug for category "${pathKey}"`);
  }

  /** Returns the conflicting field list for P2002, or undefined otherwise. */
  private uniqueViolationTarget(error: unknown): string[] | undefined {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return undefined;
    }

    const target = (error.meta as { target?: string[] | string } | undefined)
      ?.target;
    if (Array.isArray(target)) return target;
    return target ? [target] : [];
  }
}
