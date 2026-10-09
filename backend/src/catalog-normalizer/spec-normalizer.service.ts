import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  canonicalSpec,
  inferUnitFromValues,
  normalizeSpecValue,
} from '../parser/spec-canonical';
import { shouldBeFilterable } from '../parser/spec-filterable';

/**
 * Rows touched per statement. Large enough that 227k characteristic values are
 * a few dozen round trips, small enough that no single statement holds a long
 * lock on a table the parsers are writing to at the same time.
 */
const CHUNK = 2_000;

/** Page size for reading `ProductSpecification` during value normalization. */
const VALUE_PAGE = 20_000;

/**
 * A characteristic with more distinct values than this *share* of the products
 * that carry it is an identity field, not a filter — a barcode or an article
 * number that the name blocklist did not catch.
 */
const MAX_DISTINCT_SHARE = 0.5;

/** Below this many products a share means nothing, so only the cap applies. */
const MIN_PRODUCTS_FOR_SHARE = 20;

/** However many products carry it, this many options is not a filter. */
const MAX_DISTINCT_VALUES = 60;

export type SpecNormalizeReport = {
  /** True when nothing was written and the numbers are a preview. */
  dryRun: boolean;
  /** `Specification` rows given (or corrected) a canonical identity. */
  canonicalWritten: number;
  /** Characteristics whose unit was recovered from their values. */
  unitsInferred: number;
  /** `ProductSpecification` values rewritten to the normalized form. */
  valuesNormalized: number;
  /** Values that carried no information and were removed. */
  valuesDropped: number;
  /** Duplicate `Specification` rows folded into a surviving row. */
  specsMerged: number;
  /**
   * Characteristics switched on / off as filters. `null` after a dry run: the
   * decision is made from the distinct values a characteristic has *after* the
   * value pass, which a dry run has not written, so any number here would be a
   * guess. It is also the only step that is trivially reversible — `filterable`
   * is a boolean admins flip in `/admin/specifications` — so it is the one step
   * worth leaving unpreviewed.
   */
  filtersEnabled: number | null;
  filtersDisabled: number | null;
};

/** The canonical identity resolved for one `Specification` row. */
type SpecIdentity = {
  categoryId: string;
  key: string;
  name: string;
  unit: string | null;
};

/**
 * Brings every characteristic already in the catalogue onto the canonical layer
 * that `parser/spec-canonical.ts` defines, and keeps it there.
 *
 * The parsers write canonical identity for everything they touch from now on,
 * but a 35k-product catalogue imported before that exists needs a sweep — and
 * it needs re-running, because a new supplier keeps inventing spellings and
 * because `filterable` can only be judged against real data (how many distinct
 * values a characteristic actually has, which the parser cannot know when it
 * sees the first product).
 *
 * Everything here is idempotent: a second run over an already-normalized
 * catalogue reports all zeros.
 */
@Injectable()
export class SpecNormalizerService {
  private readonly logger = new Logger(SpecNormalizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `dryRun` reports what a real run would change without writing anything.
   *
   * It matters here more than in the category pass: this is the destructive
   * one. It deletes `ProductSpecification` rows whose value carries no
   * information (6188 products arrived with `Вес = "0 кг"`) and deletes the
   * duplicate `Specification` rows it folds together. Both of those counts —
   * `valuesDropped` and `specsMerged` — are exact in a preview, because every
   * step after the canonical pass works off the identity that pass resolved in
   * memory rather than off the column it would have written.
   */
  async normalize(dryRun = false): Promise<SpecNormalizeReport> {
    const units = await this.inferUnits();
    const { written, identity } = await this.writeCanonicalIdentity(
      units,
      dryRun,
    );
    const values = await this.normalizeValues(identity, dryRun);
    const specsMerged = await this.mergeDuplicateSpecifications(
      identity,
      dryRun,
    );
    const filters = dryRun
      ? { filtersEnabled: null, filtersDisabled: null }
      : await this.recomputeFilterable();

    const report: SpecNormalizeReport = {
      dryRun,
      canonicalWritten: written,
      unitsInferred: units.size,
      ...values,
      specsMerged,
      ...filters,
    };

    this.logger.log(
      `Specification normalization${dryRun ? ' (dry run)' : ''}: ${JSON.stringify(report)}`,
    );
    return report;
  }

  /**
   * Unit per characteristic, read from its values, for the characteristics
   * whose *name* carries none. This is what makes `Вес` and `Вес, кг` one
   * filter: 773 rows named plainly "Вес" hold values like "0.5 кг".
   */
  private async inferUnits(): Promise<Map<string, string>> {
    // One scan, 20 sample values per characteristic — enough for a majority
    // vote and bounded regardless of how many products carry it.
    const rows = await this.prisma.$queryRaw<
      Array<{ specificationId: string; values: string[] }>
    >`
      SELECT "specificationId", (array_agg(DISTINCT value))[1:20] AS values
      FROM "ProductSpecification"
      GROUP BY "specificationId"
    `;

    const units = new Map<string, string>();
    for (const row of rows) {
      const unit = inferUnitFromValues(row.values ?? []);
      if (unit) units.set(row.specificationId, unit);
    }
    return units;
  }

  /**
   * Writes `canonicalKey` / `canonicalName` / `canonicalUnit` wherever they are
   * missing or out of date. Recomputing is deliberate: the dictionary in
   * `spec-canonical.ts` grows, and an entry added for a newly observed
   * duplicate has to reach the rows imported before it existed.
   *
   * Returns the identity it resolved for **every** row, not just the changed
   * ones, so the passes after it work off what was decided here instead of
   * re-reading the column. That is what makes a dry run meaningful: nothing is
   * written, yet the value and merge passes still see the canonical layer a
   * real run would have left behind.
   */
  private async writeCanonicalIdentity(
    units: Map<string, string>,
    dryRun: boolean,
  ): Promise<{ written: number; identity: Map<string, SpecIdentity> }> {
    const specs = await this.prisma.specification.findMany({
      select: {
        id: true,
        categoryId: true,
        name: true,
        canonicalKey: true,
        canonicalName: true,
        canonicalUnit: true,
      },
    });

    const identity = new Map<string, SpecIdentity>();
    const updates: Array<{
      id: string;
      key: string;
      name: string;
      unit: string | null;
    }> = [];

    for (const spec of specs) {
      // The stored unit is the fallback of last resort, and it has to be:
      // `inferUnits()` reads the unit out of the values ("2.5 кг"), and the
      // value pass then strips it ("2.5"). Without this, a second run can no
      // longer infer `кг` for a characteristic named plainly "Вес", so its key
      // would flip back from `ves~kg` to `ves` — splitting the filter that the
      // first run merged, and breaking every catalogue URL that carries the
      // old key. A unit spelled out in the *name* still wins over both.
      const canonical = canonicalSpec(
        spec.name,
        units.get(spec.id) ?? spec.canonicalUnit ?? undefined,
      );

      if (!canonical) {
        // No canonical reading of this name — one row in production. Carry the
        // stored identity forward so the later passes see the same state a real
        // run would leave them.
        if (spec.canonicalKey) {
          identity.set(spec.id, {
            categoryId: spec.categoryId,
            key: spec.canonicalKey,
            name: spec.canonicalName ?? spec.name,
            unit: spec.canonicalUnit,
          });
        }
        continue;
      }

      const unit = canonical.unit ?? null;
      identity.set(spec.id, {
        categoryId: spec.categoryId,
        key: canonical.key,
        name: canonical.name,
        unit,
      });

      const unchanged =
        spec.canonicalKey === canonical.key &&
        spec.canonicalName === canonical.name &&
        spec.canonicalUnit === unit;
      if (unchanged) continue;

      updates.push({
        id: spec.id,
        key: canonical.key,
        name: canonical.name,
        unit,
      });
    }

    if (!dryRun) {
      for (const batch of chunk(updates, CHUNK)) {
        const values = batch.map(
          (row) =>
            Prisma.sql`(${row.id}, ${row.key}, ${row.name}, ${row.unit}::text)`,
        );
        await this.prisma.$executeRaw`
          UPDATE "Specification" AS s
          SET "canonicalKey" = v.key,
              "canonicalName" = v.name,
              "canonicalUnit" = v.unit
          FROM (VALUES ${Prisma.join(values)}) AS v(id, key, name, unit)
          WHERE s.id = v.id
        `;
      }
    }

    return { written: updates.length, identity };
  }

  /**
   * Rewrites characteristic values to their normalized form and removes the
   * ones that carry no information.
   *
   * Removal, not a null `valueNorm`: `Вес = "0 кг"` on 6188 products is wrong
   * data, and leaving it in place would keep showing a zero weight on the
   * product page while hiding it from the filter. The parsers now refuse to
   * store these in the first place.
   */
  private async normalizeValues(
    identity: Map<string, SpecIdentity>,
    dryRun: boolean,
  ): Promise<{
    valuesNormalized: number;
    valuesDropped: number;
  }> {
    let valuesNormalized = 0;
    let valuesDropped = 0;
    let cursor: string | undefined;

    for (;;) {
      // Keyset pagination over a plain `where`, not Prisma's `cursor`: this
      // loop deletes rows from the page it has just read, and the last row of a
      // page can be one of them. Prisma resolves `cursor` against a row that
      // still exists, so once that row is gone the sweep skips rows or stops
      // early — silently, and only on the catalogues that actually have garbage
      // to drop, which is to say exactly when the pass matters.
      const page = await this.prisma.productSpecification.findMany({
        select: {
          id: true,
          specificationId: true,
          value: true,
          valueNorm: true,
        },
        where: cursor ? { id: { gt: cursor } } : undefined,
        orderBy: { id: 'asc' },
        take: VALUE_PAGE,
      });
      if (!page.length) break;
      cursor = page[page.length - 1].id;

      const rewrite: Array<{ id: string; value: string; norm: string }> = [];
      const drop: string[] = [];

      for (const row of page) {
        const unit = identity.get(row.specificationId)?.unit ?? undefined;
        const { display, facet } = normalizeSpecValue(row.value, unit);

        if (facet === null) {
          drop.push(row.id);
          continue;
        }
        if (row.value === display && row.valueNorm === facet) continue;

        rewrite.push({ id: row.id, value: display, norm: facet });
      }

      if (!dryRun) {
        for (const batch of chunk(rewrite, CHUNK)) {
          const values = batch.map(
            (row) => Prisma.sql`(${row.id}, ${row.value}, ${row.norm})`,
          );
          await this.prisma.$executeRaw`
            UPDATE "ProductSpecification" AS ps
            SET value = v.value, "valueNorm" = v.norm
            FROM (VALUES ${Prisma.join(values)}) AS v(id, value, norm)
            WHERE ps.id = v.id
          `;
        }

        for (const batch of chunk(drop, CHUNK)) {
          await this.prisma.productSpecification.deleteMany({
            where: { id: { in: batch } },
          });
        }
      }

      valuesNormalized += rewrite.length;
      valuesDropped += drop.length;
      if (page.length < VALUE_PAGE) break;
    }

    return { valuesNormalized, valuesDropped };
  }

  /**
   * Folds `Specification` rows that share a canonical key *inside one category*
   * into a single row.
   *
   * These exist because `key` is `generateSlug(name)`, which separates
   * spellings the canonical layer unifies: `Обороты, об/мин` slugs to
   * `oboroty-ob-min` and `Обороты, обмин` to `oboroty-obmin`, so one category
   * ended up with two rows for one characteristic — and two checkboxes for it
   * in the sidebar.
   *
   * The survivor is the row most products already point at, so the fewest
   * `ProductSpecification` rows have to move.
   */
  private async mergeDuplicateSpecifications(
    identity: Map<string, SpecIdentity>,
    dryRun: boolean,
  ): Promise<number> {
    if (dryRun) return countMergeableSpecifications(identity);

    const groups = await this.prisma.$queryRaw<
      Array<{ survivor: string; losers: string[] }>
    >`
      WITH counted AS (
        SELECT s.id, s."categoryId", s."canonicalKey",
               count(ps.id) AS uses
        FROM "Specification" s
        LEFT JOIN "ProductSpecification" ps ON ps."specificationId" = s.id
        WHERE s."canonicalKey" IS NOT NULL
        GROUP BY s.id, s."categoryId", s."canonicalKey"
      ), ranked AS (
        SELECT id, "categoryId", "canonicalKey",
               row_number() OVER (
                 PARTITION BY "categoryId", "canonicalKey"
                 ORDER BY uses DESC, id
               ) AS rn
        FROM counted
      )
      SELECT
        max(id) FILTER (WHERE rn = 1) AS survivor,
        array_agg(id) FILTER (WHERE rn > 1) AS losers
      FROM ranked
      GROUP BY "categoryId", "canonicalKey"
      HAVING count(*) > 1
    `;

    let merged = 0;

    for (const group of groups) {
      const losers = (group.losers ?? []).filter(Boolean);
      if (!group.survivor || !losers.length) continue;

      await this.prisma.$transaction(async (tx) => {
        // Move what can move. `@@unique([productId, specificationId])` means a
        // product already carrying the survivor's row cannot take a second
        // one, so those are skipped and deleted below.
        await tx.$executeRaw`
          UPDATE "ProductSpecification" ps
          SET "specificationId" = ${group.survivor}
          WHERE ps."specificationId" = ANY(${losers})
            AND NOT EXISTS (
              SELECT 1 FROM "ProductSpecification" keep
              WHERE keep."productId" = ps."productId"
                AND keep."specificationId" = ${group.survivor}
            )
        `;
        await tx.productSpecification.deleteMany({
          where: { specificationId: { in: losers } },
        });
        await tx.specification.deleteMany({ where: { id: { in: losers } } });
      });

      merged += losers.length;
    }

    return merged;
  }

  /**
   * Decides `filterable` from the data rather than from the name alone.
   *
   * `shouldBeFilterable()` runs at parse time, when the only thing known is the
   * name and one value, and it let 15 260 of 17 857 characteristics through —
   * including "Со сменными вставками" and whatever else a supplier happened to
   * put in its table. With the whole catalogue in front of us the question is
   * answerable: a characteristic is a filter when it has at least two options
   * and its options are not nearly unique per product.
   *
   * The judgement is made per canonical group, so a characteristic is on or off
   * consistently everywhere instead of per category.
   */
  private async recomputeFilterable(): Promise<{
    filtersEnabled: number;
    filtersDisabled: number;
  }> {
    const stats = await this.prisma.$queryRaw<
      Array<{
        canonicalKey: string;
        canonicalName: string | null;
        products: bigint;
        distinctValues: bigint;
      }>
    >`
      SELECT s."canonicalKey" AS "canonicalKey",
             min(s."canonicalName") AS "canonicalName",
             count(DISTINCT ps."productId") AS products,
             count(DISTINCT ps."valueNorm") AS "distinctValues"
      FROM "Specification" s
      JOIN "ProductSpecification" ps ON ps."specificationId" = s.id
      WHERE s."canonicalKey" IS NOT NULL AND ps."valueNorm" IS NOT NULL
      GROUP BY s."canonicalKey"
    `;

    const enable: string[] = [];
    const disable: string[] = [];

    for (const row of stats) {
      const products = Number(row.products);
      const distinct = Number(row.distinctValues);

      const useful =
        shouldBeFilterable(row.canonicalName ?? row.canonicalKey) &&
        distinct > 1 &&
        distinct <= MAX_DISTINCT_VALUES &&
        (products < MIN_PRODUCTS_FOR_SHARE ||
          distinct / products <= MAX_DISTINCT_SHARE);

      (useful ? enable : disable).push(row.canonicalKey);
    }

    // Keys that exist but carry no usable value at all are not filters either.
    const seen = new Set([...enable, ...disable]);
    const orphans = (
      await this.prisma.specification.groupBy({
        by: ['canonicalKey'],
        where: { canonicalKey: { not: null } },
      })
    )
      .map((row) => row.canonicalKey)
      .filter((key): key is string => Boolean(key))
      .filter((key) => !seen.has(key));
    disable.push(...orphans);

    let filtersEnabled = 0;
    let filtersDisabled = 0;

    for (const batch of chunk(enable, CHUNK)) {
      filtersEnabled += await this.prisma.specification
        .updateMany({
          where: { canonicalKey: { in: batch }, filterable: false },
          data: { filterable: true },
        })
        .then((result) => result.count);
    }
    for (const batch of chunk(disable, CHUNK)) {
      filtersDisabled += await this.prisma.specification
        .updateMany({
          where: { canonicalKey: { in: batch }, filterable: true },
          data: { filterable: false },
        })
        .then((result) => result.count);
    }

    return { filtersEnabled, filtersDisabled };
  }

  /**
   * What the catalogue looks like through the canonical layer. Backs the admin
   * report, and is the quickest way to see whether a run did anything.
   */
  async getReport(limit = 50) {
    const [totals, top] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          specifications: bigint;
          canonical: bigint;
          canonicalKeys: bigint;
          filterable: bigint;
          values: bigint;
          normalized: bigint;
        }>
      >`
        SELECT
          (SELECT count(*) FROM "Specification") AS specifications,
          (SELECT count(*) FROM "Specification" WHERE "canonicalKey" IS NOT NULL) AS canonical,
          (SELECT count(DISTINCT "canonicalKey") FROM "Specification") AS "canonicalKeys",
          (SELECT count(*) FROM "Specification" WHERE filterable) AS filterable,
          (SELECT count(*) FROM "ProductSpecification") AS values,
          (SELECT count(*) FROM "ProductSpecification" WHERE "valueNorm" IS NOT NULL) AS normalized
      `,
      this.prisma.$queryRaw<
        Array<{
          canonicalKey: string;
          canonicalName: string | null;
          canonicalUnit: string | null;
          rows: bigint;
          products: bigint;
          distinctValues: bigint;
          filterable: boolean;
        }>
      >`
        SELECT s."canonicalKey" AS "canonicalKey",
               min(s."canonicalName") AS "canonicalName",
               min(s."canonicalUnit") AS "canonicalUnit",
               count(DISTINCT s.id) AS rows,
               count(DISTINCT ps."productId") AS products,
               count(DISTINCT ps."valueNorm") AS "distinctValues",
               bool_or(s.filterable) AS filterable
        FROM "Specification" s
        LEFT JOIN "ProductSpecification" ps ON ps."specificationId" = s.id
        WHERE s."canonicalKey" IS NOT NULL
        GROUP BY s."canonicalKey"
        ORDER BY count(DISTINCT ps."productId") DESC
        LIMIT ${limit}
      `,
    ]);

    const summary = totals[0];
    return {
      totals: {
        specifications: Number(summary?.specifications ?? 0),
        withCanonicalIdentity: Number(summary?.canonical ?? 0),
        /** How many filters the storefront can actually show. */
        canonicalGroups: Number(summary?.canonicalKeys ?? 0),
        filterableRows: Number(summary?.filterable ?? 0),
        values: Number(summary?.values ?? 0),
        normalizedValues: Number(summary?.normalized ?? 0),
      },
      top: top.map((row) => ({
        key: row.canonicalKey,
        name: row.canonicalName,
        unit: row.canonicalUnit,
        /** `Specification` rows folded into this one filter. */
        categoryRows: Number(row.rows),
        products: Number(row.products),
        options: Number(row.distinctValues),
        filterable: row.filterable,
      })),
    };
  }
}

/**
 * How many `Specification` rows a run would fold away, counted from the
 * identity the canonical pass resolved rather than from the column it would
 * have written — in a dry run that column still holds the old value, or none.
 * Same grouping as the SQL in `mergeDuplicateSpecifications()`: one survivor
 * per (category, canonical key), every other row in the group is a loser.
 */
function countMergeableSpecifications(
  identity: Map<string, SpecIdentity>,
): number {
  const sizes = new Map<string, number>();
  for (const spec of identity.values()) {
    const group = `${spec.categoryId}\u0000${spec.key}`;
    sizes.set(group, (sizes.get(group) ?? 0) + 1);
  }

  let losers = 0;
  for (const size of sizes.values()) {
    if (size > 1) losers += size - 1;
  }
  return losers;
}

/** Splits a list into fixed-size batches; empty input yields nothing. */
function chunk<T>(list: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < list.length; index += size) {
    batches.push(list.slice(index, index + size));
  }
  return batches;
}
