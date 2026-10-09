import { Prisma } from '@prisma/client';
import { SpecNormalizerService } from './spec-normalizer.service';

/**
 * These cover the two things that make the characteristics pass dangerous to
 * run unsupervised: it deletes rows, and it is the pass an operator previews
 * before letting it loose on 227k production values.
 *
 * The fake below is a small in-memory Postgres stand-in rather than a pile of
 * `jest.fn()`s, because both properties under test are about what the *next*
 * step sees after the previous one wrote — a mock that records calls without
 * applying them would report a green dry run for a broken real one.
 */

type SpecRow = {
  id: string;
  categoryId: string;
  name: string;
  canonicalKey: string | null;
  canonicalName: string | null;
  canonicalUnit: string | null;
  filterable: boolean;
};

type ValueRow = {
  id: string;
  productId: string;
  specificationId: string;
  value: string;
  valueNorm: string | null;
};

class FakePrisma {
  /** Every write the service performed, so a dry run can be shown to be inert. */
  writes = 0;

  constructor(
    public specs: SpecRow[],
    public values: ValueRow[],
  ) {}

  // -- raw ----------------------------------------------------------------

  $queryRaw(strings: TemplateStringsArray): Promise<any> {
    const sql = strings.join(' ');

    if (sql.includes('array_agg(DISTINCT value)')) {
      const bySpec = new Map<string, Set<string>>();
      for (const row of this.values) {
        const seen = bySpec.get(row.specificationId) ?? new Set<string>();
        seen.add(row.value);
        bySpec.set(row.specificationId, seen);
      }
      return Promise.resolve(
        [...bySpec].map(([specificationId, seen]) => ({
          specificationId,
          values: [...seen].slice(0, 20),
        })),
      );
    }

    if (sql.includes('WITH counted')) {
      return Promise.resolve(this.mergeGroups());
    }

    if (sql.includes('count(DISTINCT ps."valueNorm")')) {
      return Promise.resolve(this.filterableStats());
    }

    throw new Error(`unexpected $queryRaw: ${sql.trim().slice(0, 60)}`);
  }

  $executeRaw(strings: TemplateStringsArray, ...params: unknown[]) {
    const sql = strings.join(' ');
    // Prisma.join() flattens its fragments' parameters into one list, so a
    // batched VALUES statement arrives as one flat array of columns.
    const flat = (params[0] as Prisma.Sql).values;
    this.writes += 1;

    if (sql.includes('UPDATE "Specification" AS s')) {
      for (let at = 0; at < flat.length; at += 4) {
        const [id, key, name, unit] = flat.slice(at, at + 4) as [
          string,
          string,
          string,
          string | null,
        ];
        const spec = this.specs.find((row) => row.id === id);
        if (!spec) continue;
        spec.canonicalKey = key;
        spec.canonicalName = name;
        spec.canonicalUnit = unit;
      }
      return Promise.resolve(flat.length / 4);
    }

    if (sql.includes('UPDATE "ProductSpecification" AS ps')) {
      for (let at = 0; at < flat.length; at += 3) {
        const [id, value, norm] = flat.slice(at, at + 3) as [
          string,
          string,
          string,
        ];
        const row = this.values.find((candidate) => candidate.id === id);
        if (!row) continue;
        row.value = value;
        row.valueNorm = norm;
      }
      return Promise.resolve(flat.length / 3);
    }

    if (sql.includes('SET "specificationId"')) {
      const [survivor, losers] = params as [string, string[]];
      for (const row of this.values) {
        if (!losers.includes(row.specificationId)) continue;
        const taken = this.values.some(
          (other) =>
            other.productId === row.productId &&
            other.specificationId === survivor,
        );
        if (taken) continue;
        row.specificationId = survivor;
      }
      return Promise.resolve(0);
    }

    throw new Error(`unexpected $executeRaw: ${sql.trim().slice(0, 60)}`);
  }

  $transaction<T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> {
    return fn(this);
  }

  // -- models -------------------------------------------------------------

  specification = {
    findMany: () => Promise.resolve(this.specs.map((row) => ({ ...row }))),

    groupBy: () =>
      Promise.resolve(
        [...new Set(this.specs.map((row) => row.canonicalKey))]
          .filter((key) => key !== null)
          .map((canonicalKey) => ({ canonicalKey })),
      ),

    updateMany: (args: {
      where: { canonicalKey: { in: string[] }; filterable: boolean };
      data: { filterable: boolean };
    }) => {
      this.writes += 1;
      let count = 0;
      for (const spec of this.specs) {
        if (!spec.canonicalKey) continue;
        if (!args.where.canonicalKey.in.includes(spec.canonicalKey)) continue;
        if (spec.filterable !== args.where.filterable) continue;
        spec.filterable = args.data.filterable;
        count += 1;
      }
      return Promise.resolve({ count });
    },

    deleteMany: (args: { where: { id: { in: string[] } } }) => {
      this.writes += 1;
      const before = this.specs.length;
      this.specs = this.specs.filter(
        (row) => !args.where.id.in.includes(row.id),
      );
      return Promise.resolve({ count: before - this.specs.length });
    },
  };

  productSpecification = {
    findMany: (args: {
      where?: { id?: { gt: string } };
      cursor?: { id: string };
      skip?: number;
      take: number;
    }) => {
      const sorted = [...this.values].sort((a, b) => a.id.localeCompare(b.id));

      let from = 0;
      if (args.where?.id?.gt) {
        from = sorted.findIndex((row) => row.id > args.where!.id!.gt);
        if (from === -1) from = sorted.length;
      } else if (args.cursor) {
        // Prisma resolves a cursor against a row that still exists. The sweep
        // deletes rows from the page it just read, so if the cursor row was one
        // of them there is nothing to resume from — which is the bug this fake
        // exists to catch.
        const at = sorted.findIndex((row) => row.id === args.cursor!.id);
        if (at === -1) return Promise.resolve([]);
        from = at + (args.skip ?? 0);
      }

      return Promise.resolve(
        sorted.slice(from, from + args.take).map((row) => ({ ...row })),
      );
    },

    deleteMany: (args: {
      where: { id?: { in: string[] }; specificationId?: { in: string[] } };
    }) => {
      this.writes += 1;
      const before = this.values.length;
      this.values = this.values.filter((row) => {
        if (args.where.id) return !args.where.id.in.includes(row.id);
        if (args.where.specificationId) {
          return !args.where.specificationId.in.includes(row.specificationId);
        }
        return true;
      });
      return Promise.resolve({ count: before - this.values.length });
    },
  };

  // -- helpers modelling the two aggregate queries ------------------------

  private mergeGroups() {
    const groups = new Map<string, SpecRow[]>();
    for (const spec of this.specs) {
      if (!spec.canonicalKey) continue;
      const key = `${spec.categoryId}\u0000${spec.canonicalKey}`;
      groups.set(key, [...(groups.get(key) ?? []), spec]);
    }

    const uses = (spec: SpecRow) =>
      this.values.filter((row) => row.specificationId === spec.id).length;

    return [...groups.values()]
      .filter((group) => group.length > 1)
      .map((group) => {
        const ranked = [...group].sort(
          (a, b) => uses(b) - uses(a) || a.id.localeCompare(b.id),
        );
        return {
          survivor: ranked[0].id,
          losers: ranked.slice(1).map((spec) => spec.id),
        };
      });
  }

  private filterableStats() {
    const byKey = new Map<
      string,
      { name: string | null; products: Set<string>; values: Set<string> }
    >();

    for (const spec of this.specs) {
      if (!spec.canonicalKey) continue;
      for (const row of this.values) {
        if (row.specificationId !== spec.id || row.valueNorm === null) continue;
        const bucket = byKey.get(spec.canonicalKey) ?? {
          name: spec.canonicalName,
          products: new Set<string>(),
          values: new Set<string>(),
        };
        bucket.products.add(row.productId);
        bucket.values.add(row.valueNorm);
        byKey.set(spec.canonicalKey, bucket);
      }
    }

    return [...byKey].map(([canonicalKey, bucket]) => ({
      canonicalKey,
      canonicalName: bucket.name,
      products: BigInt(bucket.products.size),
      distinctValues: BigInt(bucket.values.size),
    }));
  }
}

function spec(
  id: string,
  categoryId: string,
  name: string,
  filterable = false,
): SpecRow {
  return {
    id,
    categoryId,
    name,
    canonicalKey: null,
    canonicalName: null,
    canonicalUnit: null,
    filterable,
  };
}

function value(
  id: string,
  productId: string,
  specificationId: string,
  raw: string,
): ValueRow {
  return { id, productId, specificationId, value: raw, valueNorm: null };
}

/**
 * The production shapes this pass exists for: one characteristic spelled four
 * ways, a unit that only the values carry, and a supplier's `0 кг`.
 */
function catalogue() {
  const specs = [
    spec('s1', 'cat-1', 'Мощность, Вт'),
    spec('s2', 'cat-1', 'Мощность ( Вт )'),
    spec('s3', 'cat-1', 'Вес'),
    spec('s4', 'cat-1', 'Вес, кг'),
    // Same characteristic, different category: Specification is keyed per
    // category, so this one must survive the merge untouched.
    spec('s5', 'cat-2', 'Мощность, Вт'),
  ];
  const values = [
    value('v1', 'p1', 's1', '750 Вт'),
    value('v2', 'p2', 's1', '1200 Вт'),
    value('v3', 'p3', 's2', '750'),
    // "Вес" carries no unit in its name — it is inferred from these, which is
    // what folds it together with "Вес, кг". The inference needs three values
    // to call a majority, so three is what a realistic fixture has.
    value('v4', 'p1', 's3', '0 кг'),
    value('v5', 'p2', 's3', '2.5 кг'),
    value('v6', 'p5', 's3', '4 кг'),
    value('v7', 'p3', 's4', '3 кг'),
    value('v8', 'p4', 's5', '900 Вт'),
  ];
  return new FakePrisma(specs, values);
}

describe('SpecNormalizerService', () => {
  const service = (prisma: FakePrisma) =>
    new SpecNormalizerService(prisma as never);

  it('a dry run writes nothing', async () => {
    const prisma = catalogue();
    const before = JSON.stringify([prisma.specs, prisma.values]);

    const report = await service(prisma).normalize(true);

    expect(report.dryRun).toBe(true);
    expect(prisma.writes).toBe(0);
    expect(JSON.stringify([prisma.specs, prisma.values])).toBe(before);
  });

  it('predicts exactly what the real run deletes', async () => {
    const preview = await service(catalogue()).normalize(true);
    const real = await service(catalogue()).normalize(false);

    // The two destructive numbers are what the preview exists to show.
    expect(preview.valuesDropped).toBe(real.valuesDropped);
    expect(preview.specsMerged).toBe(real.specsMerged);
    // And the rest of the pass, bar the filter recount it deliberately skips.
    expect(preview.canonicalWritten).toBe(real.canonicalWritten);
    expect(preview.valuesNormalized).toBe(real.valuesNormalized);
  });

  it('drops "0 кг" and folds the spellings of one characteristic', async () => {
    const prisma = catalogue();
    const report = await service(prisma).normalize();

    expect(report.valuesDropped).toBe(1);
    expect(prisma.values.some((row) => row.value === '0 кг')).toBe(false);

    // "Мощность, Вт" + "Мощность ( Вт )" and "Вес" + "Вес, кг" are one
    // characteristic each inside cat-1; "Мощность" in cat-2 is its own row.
    expect(report.specsMerged).toBe(2);
    expect(prisma.specs).toHaveLength(3);
    expect(prisma.specs.map((row) => row.id)).toContain('s5');

    const keys = prisma.specs
      .filter((row) => row.categoryId === 'cat-1')
      .map((row) => row.canonicalKey)
      .sort();
    expect(keys).toEqual(['moshchnost~vt', 'ves~kg']);
  });

  it('leaves nothing to do on a second pass', async () => {
    const prisma = catalogue();
    await service(prisma).normalize();
    const again = await service(prisma).normalize();

    expect(again.canonicalWritten).toBe(0);
    expect(again.valuesNormalized).toBe(0);
    expect(again.valuesDropped).toBe(0);
    expect(again.specsMerged).toBe(0);
    expect(again.filtersEnabled).toBe(0);
    expect(again.filtersDisabled).toBe(0);

    // The weight filter in particular: its unit was inferred from values like
    // "2.5 кг", and the first pass rewrote those to "2.5". A second pass that
    // re-derives the key from the cleaned values would drop back to `ves`,
    // splitting the filter again and invalidating every catalogue URL holding
    // the old key.
    const weight = prisma.specs.find((row) => row.canonicalName === 'Вес');
    expect(weight?.canonicalKey).toBe('ves~kg');
    expect(weight?.canonicalUnit).toBe('кг');
  });

  it('keeps sweeping after deleting the last row of a page', async () => {
    // One page is 20 000 rows. The row on the page boundary is garbage, so the
    // sweep deletes it and then has to resume from an id that no longer exists.
    const PAGE = 20_000;
    const specs = [spec('s1', 'cat-1', 'Напряжение, В')];
    const values = Array.from({ length: PAGE + 1 }, (_, index) =>
      value(
        `v${String(index).padStart(6, '0')}`,
        `p${index}`,
        's1',
        index === PAGE - 1 ? '-' : ' 12 В ',
      ),
    );

    const prisma = new FakePrisma(specs, values);
    const report = await service(prisma).normalize();

    expect(report.valuesDropped).toBe(1);
    // The rows past the boundary are the point: every one of them must have
    // been read and rewritten, not skipped with the deleted cursor.
    expect(report.valuesNormalized).toBe(PAGE);
    expect(prisma.values).toHaveLength(PAGE);
    expect(prisma.values.every((row) => row.valueNorm === '12')).toBe(true);
  });
});
