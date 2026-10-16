import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { generateSlug } from '../../common/utils/generate-slug';
import {
  categoryPathKey,
  categorySlugCandidates,
  numberedSlug,
} from './category-slug';
import { canonicalRootFor, normalizeCategoryName } from './taxonomy';

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

    // The supplier still spells the old chain of a category an admin moved,
    // re-slugged or merged. Follow the alias to where it lives now — and
    // leave it there: no parent "repair" for a deliberate move.
    const alias = await this.prisma.categoryPathAlias.findUnique({
      where: { pathKey },
      select: { category: { select: { id: true, slug: true, pathKey: true } } },
    });
    if (alias) return alias.category;

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

    // No row at this identity — but the parent may already have a child of
    // this name. That happens whenever a branch has moved: the nightly
    // normalizer merges a supplier root («Специальный инструмент») into its
    // canonical one, which re-keys the moved children, so the next parse of
    // the old breadcrumbs found nothing at the old `pathKey`, created the
    // branch again, and the next merge put a second «Двигатель» beside the
    // first. Six nights later prod had six of them (`…-dvigatel-2` … `-6`).
    // A same-named child of the same parent *is* the same category, so use it.
    const twin = await this.findSameNamedChild(name, parentId);
    if (twin) return twin;

    return this.createWithFreeSlug(name, pathSlugs, parentId, pathKey);
  }

  /**
   * The existing category named `name` directly under `parentId`, compared on
   * the normalized name (case, `ё`, spacing). At the root a supplier synonym
   * resolves to its canonical department first (see `taxonomy.ts`), so a
   * supplier root the normalizer has already merged is not re-created.
   * The oldest-looking (shortest) slug wins when there are several.
   */
  private async findSameNamedChild(
    name: string,
    parentId: string | null,
  ): Promise<UpsertedCategory | null> {
    const wanted = new Set([normalizeCategoryName(name)]);
    if (parentId === null) {
      const canonical = canonicalRootFor(name);
      if (canonical) wanted.add(normalizeCategoryName(canonical));
    }

    const siblings = await this.prisma.category.findMany({
      where: { parentId },
      select: { id: true, name: true, slug: true, pathKey: true },
    });
    const matches = siblings.filter((row) =>
      wanted.has(normalizeCategoryName(row.name)),
    );
    if (!matches.length) return null;

    // Prefer an exact-name match over the synonym, then the shortest slug.
    const exact = normalizeCategoryName(name);
    matches.sort(
      (a, b) =>
        Number(normalizeCategoryName(b.name) === exact) -
          Number(normalizeCategoryName(a.name) === exact) ||
        a.slug.length - b.slug.length ||
        a.slug.localeCompare(b.slug),
    );
    const [winner] = matches;
    return { id: winner.id, slug: winner.slug, pathKey: winner.pathKey };
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
