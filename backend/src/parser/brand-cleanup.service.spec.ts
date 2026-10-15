import { BrandCleanupService } from './brand-cleanup.service';
import { PrismaService } from '../prisma/prisma.service';

function setup(
  brands: Array<{ id: string; name: string; rules?: number }>,
  productsByBrand: Record<string, number>,
) {
  const deleted: string[] = [];
  const detached: string[] = [];
  const prisma = {
    brand: {
      findMany: jest.fn(() =>
        Promise.resolve(
          brands.map((brand) => ({
            id: brand.id,
            name: brand.name,
            _count: { pricingRules: brand.rules ?? 0 },
          })),
        ),
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        deleted.push(where.id);
        return Promise.resolve({});
      }),
    },
    product: {
      updateMany: jest.fn(({ where }: { where: { brandId: string } }) => {
        detached.push(where.brandId);
        return Promise.resolve({ count: productsByBrand[where.brandId] ?? 0 });
      }),
    },
  } as unknown as PrismaService;
  return { service: new BrandCleanupService(prisma), deleted, detached };
}

describe('BrandCleanupService', () => {
  it('detaches products from non-brands and deletes those rows', async () => {
    const { service, deleted, detached } = setup(
      [
        { id: 'makita', name: 'Makita' },
        { id: 'parts', name: 'запчасти' },
        { id: 'm7', name: 'Запчасти М-7' },
        { id: 'none', name: 'без товарного знака' },
      ],
      { parts: 712, m7: 458, none: 1 },
    );

    const report = await service.run();

    expect(detached).toEqual(['parts', 'm7', 'none']);
    expect(deleted).toEqual(['parts', 'm7', 'none']);
    expect(report).toEqual({
      bogusBrands: 3,
      productsDetached: 1171,
      brandsDeleted: 3,
      keptForPricingRules: [],
    });
  });

  it('keeps a bogus row a pricing rule points at, but still detaches products', async () => {
    const { service, deleted, detached } = setup(
      [{ id: 'parts', name: 'запчасти', rules: 1 }],
      { parts: 5 },
    );

    const report = await service.run();

    expect(detached).toEqual(['parts']);
    expect(deleted).toEqual([]);
    expect(report.keptForPricingRules).toEqual(['запчасти']);
  });

  it('writes nothing on a clean catalogue', async () => {
    const { service, deleted, detached } = setup(
      [{ id: 'bosch', name: 'Bosch' }],
      {},
    );
    await service.run();
    expect(deleted).toEqual([]);
    expect(detached).toEqual([]);
  });
});
