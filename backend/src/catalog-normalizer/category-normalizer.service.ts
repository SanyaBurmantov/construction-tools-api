import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryMergeService } from '../admin/category-merge.service';
import {
  PARSER_SOURCES,
  ParserSettingsService,
} from '../parser/parser-settings.service';
import { FALLBACK_CATEGORY_SLUG } from '../common/constants/catalog';
import {
  canonicalRootFor,
  isPlaceholderCategory,
  normalizeCategoryName,
} from '../parser/categories/taxonomy';

export type CategoryNormalizeReport = {
  /** Products hidden because their source's own filters exclude them now. */
  filteredOut: number;
  /** Products moved out of a placeholder category into the unsorted one. */
  placeholderProductsMoved: number;
  /** Placeholder / merchandising-tag categories removed. */
  placeholdersRemoved: number;
  /** Supplier roots merged into a canonical root. */
  rootsMerged: number;
  /** Categories deleted for holding neither products nor children. */
  emptyCategoriesRemoved: number;
  /** Nothing was written — the run only reported what it would do. */
  dryRun: boolean;
  /**
   * Roots this run did not touch and could not classify. The judgement calls:
   * add them to `taxonomy.ts` once a human has made the call.
   */
  unmappedRoots: Array<{ name: string; slug: string; products: number }>;
};

type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
};

/**
 * Makes the category tree source-independent, which is what the storefront
 * needs and what the parsers alone cannot deliver.
 *
 * A parser can only build the tree its supplier describes. Three suppliers
 * describing the same shop produced 52 root categories, a root literally named
 * `!!ПУСТО!!` holding 316 products, and 408 cosmetics products imported before
 * the category filter that excludes them was written.
 *
 * Every step is idempotent and has a `dryRun` mode, because merging categories
 * moves products and is tedious to unpick.
 */
@Injectable()
export class CategoryNormalizerService {
  private readonly logger = new Logger(CategoryNormalizerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merges: CategoryMergeService,
    private readonly settings: ParserSettingsService,
  ) {}

  async normalize(dryRun = false): Promise<CategoryNormalizeReport> {
    // Order matters. Filtering reads the tree as the suppliers built it, so it
    // runs before any merge renames a branch; pruning runs last, once the
    // merges have emptied whatever they are going to empty.
    const filteredOut = await this.applySourceCategoryFilters(dryRun);
    const placeholders = await this.absorbPlaceholderCategories(dryRun);
    const rootsMerged = await this.unifyRoots(dryRun);
    const emptyCategoriesRemoved = await this.pruneEmptyCategories(dryRun);
    const unmappedRoots = await this.findUnmappedRoots();

    const report: CategoryNormalizeReport = {
      filteredOut,
      ...placeholders,
      rootsMerged,
      emptyCategoriesRemoved,
      dryRun,
      unmappedRoots,
    };

    this.logger.log(
      `Category normalization${dryRun ? ' (dry run)' : ''}: ${JSON.stringify({
        ...report,
        unmappedRoots: unmappedRoots.length,
      })}`,
    );
    return report;
  }

  /**
   * Re-applies each source's category include/exclude filters to what is
   * already imported.
   *
   * At parse time an excluded product is never created — the URL is marked
   * SKIPPED. But the filters are runtime settings that get tightened *after*
   * an import: `TH_TOOLS_CATEGORY_EXCLUDE_REGEX` lists `косметика`,
   * `велотехник` and `дача, отдых`, and the catalogue still carried 408
   * cosmetics products from before it existed. Those are not a taxonomy
   * problem to be reorganised — they are products the operator has already
   * said this shop does not sell.
   *
   * Excluded products are hidden, not deleted: the decision is reversible by
   * loosening the regex and re-running. `ARCHIVED` and already-`HIDDEN`
   * products are left alone, the same rule the parsers follow.
   */
  private async applySourceCategoryFilters(dryRun: boolean): Promise<number> {
    const nodes = await this.loadTree();
    const chains = this.buildNameChains(nodes);
    let hidden = 0;

    for (const source of PARSER_SOURCES) {
      const filters = await this.settings.getCategoryFilters(source.code);
      const include = this.compile(filters.include, source.code, 'include');
      const exclude = this.compile(filters.exclude, source.code, 'exclude');
      if (!include && !exclude) continue;

      const excludedCategoryIds = [...chains]
        .filter(([, chain]) => {
          const haystack = chain.join(' / ');
          return (
            (include && !include.test(haystack)) ||
            (exclude && exclude.test(haystack))
          );
        })
        .map(([id]) => id);
      if (!excludedCategoryIds.length) continue;

      const where = {
        status: 'PUBLISHED' as const,
        categoryId: { in: excludedCategoryIds },
        // Only products this source actually brought in. A product carried by
        // two suppliers must not be hidden because one of them filters it.
        sourceProducts: {
          every: { source: { code: source.code } },
          some: { source: { code: source.code } },
        },
      };

      if (dryRun) {
        hidden += await this.prisma.product.count({ where });
        continue;
      }

      const result = await this.prisma.product.updateMany({
        where,
        data: { status: 'HIDDEN' },
      });
      if (result.count) {
        this.logger.log(
          `${source.code}: hid ${result.count} products in categories its filters exclude`,
        );
      }
      hidden += result.count;
    }

    return hidden;
  }

  /**
   * Moves products out of placeholder and merchandising-tag categories into the
   * unsorted category, then removes the category.
   *
   * `!!ПУСТО!!` is a supplier's way of saying "no category"; `Акция` is what
   * `onSale` already answers. Neither should be a department the storefront
   * lists, and the unsorted category is where the admin catalogue tools look
   * for products that need placing.
   */
  private async absorbPlaceholderCategories(dryRun: boolean): Promise<{
    placeholderProductsMoved: number;
    placeholdersRemoved: number;
  }> {
    const nodes = await this.loadTree();
    const placeholders = nodes.filter(
      (node) =>
        isPlaceholderCategory(node.name) &&
        node.slug !== FALLBACK_CATEGORY_SLUG,
    );
    if (!placeholders.length) {
      return { placeholderProductsMoved: 0, placeholdersRemoved: 0 };
    }

    const ids = placeholders.map((node) => node.id);
    const products = await this.prisma.product.count({
      where: { categoryId: { in: ids } },
    });

    if (dryRun) {
      return {
        placeholderProductsMoved: products,
        placeholdersRemoved: placeholders.length,
      };
    }

    const fallbackId = await this.ensureFallbackCategory();
    let removed = 0;

    for (const placeholder of placeholders) {
      if (placeholder.id === fallbackId) continue;
      try {
        // The merge service moves products, supplier mappings, pricing rules
        // and child categories, and leaves a redirect behind — so an indexed
        // URL does not start 404ing.
        await this.merges.merge(placeholder.id, fallbackId);
        removed++;
      } catch (error) {
        this.logger.warn(
          `Could not absorb placeholder category "${placeholder.name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { placeholderProductsMoved: products, placeholdersRemoved: removed };
  }

  /**
   * Merges supplier roots that are the same department under another name,
   * using the hand-written synonym table in `taxonomy.ts`.
   *
   * Only roots: a supplier's deeper branches keep their own shape, which is
   * usually finer-grained than anything we would invent, and merging them would
   * be a much larger judgement call for much less benefit.
   */
  private async unifyRoots(dryRun: boolean): Promise<number> {
    const roots = (await this.loadTree()).filter((node) => !node.parentId);
    const byName = new Map(
      roots.map((root) => [normalizeCategoryName(root.name), root]),
    );

    let merged = 0;
    for (const root of roots) {
      const targetName = canonicalRootFor(root.name);
      if (!targetName) continue;

      const target = byName.get(normalizeCategoryName(targetName));
      if (!target) {
        // The canonical department does not exist in this catalogue, so there
        // is nothing to merge into. Renaming the root instead would be a
        // different (and reversible-by-hand) decision.
        this.logger.warn(
          `Canonical root "${targetName}" for "${root.name}" does not exist — skipped`,
        );
        continue;
      }
      if (target.id === root.id) continue;

      if (dryRun) {
        merged++;
        continue;
      }

      try {
        await this.merges.merge(root.id, target.id);
        this.logger.log(`Merged root "${root.name}" into "${target.name}"`);
        merged++;
      } catch (error) {
        this.logger.warn(
          `Could not merge root "${root.name}" into "${target.name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return merged;
  }

  /**
   * Deletes categories that hold neither products nor children.
   *
   * These accumulate from supplier branches that were filtered out, merged
   * away, or simply never had a product attached. The storefront already
   * prunes them from the tree, so this is about the admin surface — 1685
   * categories to scroll when a few hundred are live.
   *
   * Repeats until nothing changes: deleting a leaf can orphan its parent.
   */
  private async pruneEmptyCategories(dryRun: boolean): Promise<number> {
    let removed = 0;

    for (let pass = 0; pass < 10; pass++) {
      const empties = await this.prisma.category.findMany({
        where: {
          products: { none: {} },
          children: { none: {} },
          slug: { not: FALLBACK_CATEGORY_SLUG },
          // A category a supplier mapping or a pricing rule points at is
          // configuration, not debris.
          mappedSourceCategories: { none: {} },
          pricingRules: { none: {} },
        },
        select: { id: true },
      });
      if (!empties.length) break;

      removed += empties.length;
      if (dryRun) break;

      const ids = empties.map((row) => row.id);
      // Specifications reference the category with ON DELETE RESTRICT, and an
      // empty category's specifications have no values left to lose.
      await this.prisma.specification.deleteMany({
        where: { categoryId: { in: ids }, productSpecs: { none: {} } },
      });
      await this.prisma.categoryRedirect.deleteMany({
        where: { categoryId: { in: ids } },
      });
      await this.prisma.category.deleteMany({ where: { id: { in: ids } } });
    }

    return removed;
  }

  /**
   * Roots the synonym table says nothing about. This is the queue of
   * judgement calls — "is `Оборудование` a department or a catch-all?" — that
   * a human answers by adding a line to `taxonomy.ts`.
   */
  private async findUnmappedRoots() {
    const roots = await this.prisma.category.findMany({
      where: { parentId: null, slug: { not: FALLBACK_CATEGORY_SLUG } },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });

    const counts = await this.prisma.product.groupBy({
      by: ['categoryId'],
      where: { status: 'PUBLISHED' },
      _count: { _all: true },
    });
    const direct = new Map(
      counts.map((row) => [row.categoryId, row._count._all]),
    );

    return roots
      .filter(
        (root) =>
          !canonicalRootFor(root.name) && !isPlaceholderCategory(root.name),
      )
      .map((root) => ({
        name: root.name,
        slug: root.slug,
        products: direct.get(root.id) ?? 0,
      }));
  }

  /** The whole tree, in one query — every step needs it. */
  private loadTree(): Promise<CategoryNode[]> {
    return this.prisma.category.findMany({
      select: { id: true, name: true, slug: true, parentId: true },
    });
  }

  /**
   * Name chain from the root for every category, which is what the category
   * filters match against — the parsers test `names.join(' / ')`, so the
   * retroactive check has to build the same string.
   */
  private buildNameChains(nodes: CategoryNode[]): Map<string, string[]> {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const chains = new Map<string, string[]>();

    const chainFor = (id: string, guard: Set<string>): string[] => {
      const cached = chains.get(id);
      if (cached) return cached;

      const node = byId.get(id);
      if (!node || guard.has(id)) return [];
      guard.add(id);

      const chain = node.parentId
        ? [...chainFor(node.parentId, guard), node.name]
        : [node.name];
      chains.set(id, chain);
      return chain;
    };

    for (const node of nodes) chainFor(node.id, new Set());
    return chains;
  }

  /**
   * Compiles a configured regex, tolerating a broken one. The settings writer
   * validates these, but a value that reached the DB another way must not take
   * the whole normalizer down.
   */
  private compile(
    pattern: string,
    sourceCode: string,
    kind: 'include' | 'exclude',
  ): RegExp | null {
    if (!pattern?.trim()) return null;
    try {
      return new RegExp(pattern, 'i');
    } catch (error) {
      this.logger.warn(
        `Ignoring invalid ${kind} filter for ${sourceCode}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async ensureFallbackCategory(): Promise<string> {
    const existing = await this.prisma.category.findUnique({
      where: { slug: FALLBACK_CATEGORY_SLUG },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.category.create({
      data: {
        name: 'Неразобранные товары поставщиков',
        slug: FALLBACK_CATEGORY_SLUG,
        pathKey: FALLBACK_CATEGORY_SLUG,
        level: 0,
        path: [FALLBACK_CATEGORY_SLUG],
        seoTitle: 'Неразобранные товары поставщиков',
        seoDescription: 'Неразобранные товары поставщиков',
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Root-level shape of the catalogue, for the admin report. */
  async getReport() {
    const [roots, unmapped] = await Promise.all([
      this.prisma.category.findMany({
        where: { parentId: null },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { products: true, children: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.findUnmappedRoots(),
    ]);

    return {
      totals: {
        categories: await this.prisma.category.count(),
        roots: roots.length,
        unmappedRoots: unmapped.length,
      },
      roots: roots.map((root) => ({
        name: root.name,
        slug: root.slug,
        directProducts: root._count.products,
        children: root._count.children,
        placeholder: isPlaceholderCategory(root.name),
        mergesInto: canonicalRootFor(root.name) ?? null,
      })),
      unmappedRoots: unmapped,
    };
  }
}
