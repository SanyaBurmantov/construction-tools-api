/**
 * A product that changed category must not keep the old category's
 * characteristics beside the new ones (2068 products on 2026-11-12 showed
 * «Бренд», «Вес», «Код» twice). Against a real Postgres, because the fold is
 * SQL.
 *
 * Skipped unless SPEC_FOLD_TEST_DATABASE_URL points at a throwaway database
 * whose name ends in `_test` — the test TRUNCATES the catalogue.
 *
 *   SPEC_FOLD_TEST_DATABASE_URL=postgresql://…/specfold_test \
 *     npx jest src/parser/moved-specs.db.spec.ts --runInBand
 */
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductIdentityService } from './product-identity.service';

const url = process.env.SPEC_FOLD_TEST_DATABASE_URL ?? '';
const safe = /\/[^/?]+_test(\?|$)/.test(url);
const describeDb = safe ? describe : describe.skip;

describeDb('specifications of a product that changed category', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url } },
  }) as unknown as PrismaService;
  const identity = new ProductIdentityService(prisma);
  let oldCat = '';
  let newCat = '';

  const category = (name: string, slug: string) =>
    prisma.category.create({
      data: {
        name,
        slug,
        pathKey: slug,
        level: 0,
        seoTitle: name,
        seoDescription: name,
      },
    });

  /** A product parsed in `oldCat`, then re-filed into `newCat`. */
  const movedProduct = async (slug: string, specs: Record<string, string>) => {
    const product = await prisma.product.create({
      data: {
        name: slug,
        slug,
        status: 'PUBLISHED',
        categoryId: oldCat,
      } as never,
    });
    await identity.saveSpecifications(
      Object.entries(specs).map(([name, value]) => ({ name, value })),
      product.id,
      oldCat,
    );
    await prisma.product.update({
      where: { id: product.id },
      data: { categoryId: newCat },
    });
    return product.id;
  };

  const shown = async (productId: string) =>
    (
      await prisma.productSpecification.findMany({
        where: { productId },
        include: { specification: true },
      })
    )
      .map((row) => ({
        name: row.specification.name,
        value: row.value,
        inCurrent: row.specification.categoryId === newCat,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "ProductSpecification","Specification","Product","Category" CASCADE',
    );
    oldCat = (await category('Трещотки', 'treshchotki')).id;
    newCat = (await category('Запчасти трещоток', 'zapchasti-treshchotki')).id;
  });

  afterAll(() => prisma.$disconnect());

  it('the next parse leaves one row per characteristic, the fresh value', async () => {
    const id = await movedProduct('rotor', {
      Бренд: 'Запчасти М-7',
      Код: '50180',
      Цвет: 'чёрный',
    });

    await identity.saveSpecifications(
      [
        { name: 'Бренд', value: 'Запчасти М-7' },
        { name: 'Код', value: '50196' },
      ],
      id,
      oldCat,
    );

    // «Цвет» the supplier no longer repeats is moved, not lost.
    expect(await shown(id)).toEqual([
      { name: 'Бренд', value: 'Запчасти М-7', inCurrent: true },
      { name: 'Код', value: '50196', inCurrent: true },
      { name: 'Цвет', value: 'Чёрный', inCurrent: true },
    ]);
  });

  it('the nightly pass folds what piled up, and a dry run only counts', async () => {
    const a = await movedProduct('a', { Вес: '0.013 кг', Код: '1' });
    const b = await movedProduct('b', { Вес: '0.5 кг' });
    // Duplicates as they exist in production: written straight under the
    // new category, the old rows left behind.
    for (const [productId, name, value] of [
      [a, 'Вес', '0.013 кг'],
      [a, 'Код', '1'],
    ]) {
      const spec = await identity.upsertSpecification(
        newCat,
        name,
        name === 'Вес' ? 'ves' : 'kod',
        value,
      );
      await prisma.productSpecification.create({
        data: { productId, specificationId: spec!.id, value },
      });
    }
    const untouched = await prisma.product.create({
      data: {
        name: 'c',
        slug: 'c',
        status: 'PUBLISHED',
        categoryId: newCat,
      } as never,
    });
    await identity.saveSpecifications(
      [{ name: 'Вес', value: '2 кг' }],
      untouched.id,
      newCat,
    );

    expect(await identity.foldMovedSpecifications(undefined, true)).toEqual({
      dropped: 2,
      moved: 1,
    });
    expect(await prisma.productSpecification.count()).toBe(6);

    expect(await identity.foldMovedSpecifications()).toEqual({
      dropped: 2,
      moved: 1,
    });
    expect((await shown(a)).every((row) => row.inCurrent)).toBe(true);
    expect(await shown(a)).toHaveLength(2);
    expect(await shown(b)).toEqual([
      { name: 'Вес', value: '0.5 кг', inCurrent: true },
    ]);
    expect(await shown(untouched.id)).toHaveLength(1);

    // Idempotent.
    expect(await identity.foldMovedSpecifications()).toEqual({
      dropped: 0,
      moved: 0,
    });
  });
});
