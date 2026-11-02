import { OffersService } from './offers.service';
import type { ProductMergeService } from './product-merge.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PricingService } from '../pricing/pricing.service';

/**
 * A barcode group is merged unless one supplier lists two of its products
 * under different articles: th-tool.by gives one EAN to a whole series.
 * Articles of different suppliers are their own numbers and prove nothing.
 */
function run(offers: Array<{ sourceId: string; sku: string | null }>) {
  const merge = jest.fn(() => Promise.resolve({}));
  const prisma = {
    product: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            id: 'a',
            status: 'PUBLISHED',
            statusSource: 'SYSTEM',
            _count: { sourceProducts: 1 },
          },
          {
            id: 'b',
            status: 'PUBLISHED',
            statusSource: 'SYSTEM',
            _count: { sourceProducts: 1 },
          },
        ]),
      ),
    },
    sourceProduct: { findMany: jest.fn(() => Promise.resolve(offers)) },
  } as unknown as PrismaService;
  const service = new OffersService(
    prisma,
    {} as PricingService,
    { merge } as unknown as ProductMergeService,
  );
  const product = (id: string) => ({
    id,
    name: 'Клипса',
    slug: id,
    sku: null,
    barcode: '4811450262728',
    model: null,
    costPrice: null,
    priceValue: 10,
    brandName: null,
    offerCount: 1,
    image: null,
  });
  jest.spyOn(service, 'findDuplicates').mockResolvedValue([
    {
      signal: 'barcode',
      confidence: 'exact',
      key: '4811450262728',
      products: [product('a'), product('b')],
    },
  ]);
  jest.spyOn(service, 'recomputeFromOffers').mockResolvedValue(null);
  return service.autoMerge().then((result) => ({ result, merge }));
}

describe('auto-merge by barcode', () => {
  it('does not merge two articles of one supplier', async () => {
    const { result, merge } = await run([
      { sourceId: 'th', sku: 'C0044[ GM ]' },
      { sourceId: 'th', sku: 'C0046[ GM ]' },
    ]);
    expect(merge).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('merges one product two suppliers number differently', async () => {
    const { merge } = await run([
      { sourceId: 'th', sku: 'C0044' },
      { sourceId: 'tools', sku: '45678' },
    ]);
    expect(merge).toHaveBeenCalledTimes(1);
  });
});
