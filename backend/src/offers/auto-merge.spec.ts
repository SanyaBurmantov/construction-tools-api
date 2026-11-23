import { OffersService } from './offers.service';
import { planAutoMerge, type AutoMergeMember } from './auto-merge-plan';
import type { ProductMergeService } from './product-merge.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PricingService } from '../pricing/pricing.service';

const RATIO = { maxPriceRatio: 1.5 };

function member(
  id: string,
  sourceIds: string[],
  extra: Partial<AutoMergeMember> = {},
): AutoMergeMember {
  return {
    id,
    status: 'PUBLISHED',
    statusSource: 'SYSTEM',
    priceValue: 10,
    liveOffers: sourceIds.length,
    offerCount: sourceIds.length,
    hasImage: true,
    sourceIds,
    ...extra,
  };
}

describe('planAutoMerge', () => {
  it('merges one product from each of two suppliers (BaumAuto at dukon and th-tool)', () => {
    expect(
      planAutoMerge(
        [member('dukon-card', ['dukon']), member('th-card', ['th-tools'])],
        RATIO,
      ),
    ).toEqual({ targetId: 'dukon-card', duplicateIds: ['th-card'] });
  });

  it('leaves a supplier listing two products under one article to a human (ABRO flavours)', () => {
    expect(
      planAutoMerge(
        [
          member('lemon', ['th-tools']),
          member('coffee', ['th-tools']),
          member('b2bit-card', ['b2bit']),
        ],
        RATIO,
      ),
    ).toEqual({ skip: 'one-supplier-lists-several' });
  });

  it('treats a price gap beyond the spike threshold as a wrong match (JetaPro 1.64 vs 230)', () => {
    expect(
      planAutoMerge(
        [
          member('cup', ['tools-by'], { priceValue: 1.64 }),
          member('other', ['dukon'], { priceValue: 230.73 }),
        ],
        RATIO,
      ),
    ).toEqual({ skip: 'prices-differ' });
  });

  it('merges a dealer RRP above a retail price within the threshold (WorkPro)', () => {
    const plan = planAutoMerge(
      [
        member('dukon-knife', ['dukon'], { priceValue: 11.81 }),
        member('b2bit-knife', ['b2bit'], { priceValue: 15.49 }),
      ],
      RATIO,
    );
    expect('targetId' in plan).toBe(true);
  });

  it('ignores a product without a price when comparing prices', () => {
    const plan = planAutoMerge(
      [
        member('priced', ['dukon'], { priceValue: 10 }),
        member('draft', ['b2bit'], { priceValue: null, status: 'DRAFT' }),
      ],
      RATIO,
    );
    expect(plan).toEqual({ targetId: 'priced', duplicateIds: ['draft'] });
  });

  it('never folds away or into what an admin hid or archived', () => {
    expect(
      planAutoMerge(
        [
          member('live', ['dukon']),
          member('hidden', ['b2bit'], {
            status: 'HIDDEN',
            statusSource: 'ADMIN',
          }),
        ],
        RATIO,
      ),
    ).toEqual({ skip: 'admin-decided' });
  });

  it('keeps the card on sale with the most live offers', () => {
    const plan = planAutoMerge(
      [
        member('draft', ['b2bit'], { status: 'DRAFT' }),
        member('one', ['dukon']),
        member('two', ['th-tools', 'tools-by']),
      ],
      RATIO,
    );
    expect(plan).toEqual({ targetId: 'two', duplicateIds: ['one', 'draft'] });
  });
});

describe('OffersService.autoMerge', () => {
  type Row = {
    id: string;
    priceValue: number | null;
    sourceIds: string[];
  };

  function run(groups: Record<string, Row[]>, limit = 200) {
    const merge = jest.fn(() => Promise.resolve({}));
    const prisma = {
      // Barcode keys first, then brand+sku keys.
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce(Object.keys(groups).map((key) => ({ key })))
        .mockResolvedValueOnce([]),
      product: {
        findMany: jest.fn(({ where }: { where: { matchBarcode: string } }) =>
          Promise.resolve(
            (groups[where.matchBarcode] ?? []).map((row) => ({
              id: row.id,
              status: 'PUBLISHED',
              statusSource: 'SYSTEM',
              priceValue: row.priceValue,
              images: [{ id: 'img' }],
              sourceProducts: row.sourceIds.map((sourceId) => ({
                sourceId,
                price: row.priceValue,
              })),
            })),
          ),
        ),
      },
    } as unknown as PrismaService;
    const service = new OffersService(
      prisma,
      {} as PricingService,
      { merge } as unknown as ProductMergeService,
      { enqueue: jest.fn() } as never,
    );
    const recompute = jest
      .spyOn(service, 'recomputeFromOffers')
      .mockResolvedValue(null);
    return service
      .autoMerge(limit)
      .then((result) => ({ result, merge, recompute }));
  }

  it('merges what the plan allows, re-prices the survivor, counts the rest', async () => {
    const { result, merge, recompute } = await run({
      '4811450262728': [
        { id: 'a', priceValue: 10, sourceIds: ['dukon'] },
        { id: 'b', priceValue: 12, sourceIds: ['b2bit'] },
      ],
      '4811450262735': [
        { id: 'c', priceValue: 1.64, sourceIds: ['tools-by'] },
        { id: 'd', priceValue: 230, sourceIds: ['dukon'] },
      ],
    });
    expect(merge).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledWith('a', 'b');
    expect(recompute).toHaveBeenCalledWith('a');
    expect(result).toMatchObject({
      groups: 2,
      merged: 1,
      skipped: 1,
      reasons: { 'prices-differ': 1 },
    });
  });

  it('stops at the limit', async () => {
    const { result, merge } = await run(
      {
        k1: [
          { id: 'a', priceValue: 10, sourceIds: ['dukon'] },
          { id: 'b', priceValue: 10, sourceIds: ['b2bit'] },
        ],
        k2: [
          { id: 'c', priceValue: 10, sourceIds: ['dukon'] },
          { id: 'd', priceValue: 10, sourceIds: ['b2bit'] },
        ],
      },
      1,
    );
    expect(merge).toHaveBeenCalledTimes(1);
    expect(result.merged).toBe(1);
  });
});
