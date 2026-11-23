import { OffersService } from './offers.service';
import { planAutoMerge, type AutoMergeMember } from './auto-merge-plan';
import type { ProductMergeService } from './product-merge.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PricingService } from '../pricing/pricing.service';

function member(
  id: string,
  sourceIds: string[],
  extra: Partial<AutoMergeMember> = {},
): AutoMergeMember {
  return {
    id,
    name: 'Съемник трехлапый универсальный BaumAuto BM-03012-6',
    status: 'PUBLISHED',
    statusSource: 'SYSTEM',
    priceValue: 10,
    liveOffers: sourceIds.length,
    offerCount: sourceIds.length,
    hasImage: true,
    hasAiText: false,
    sourceIds,
    ...extra,
  };
}

describe('planAutoMerge', () => {
  it('merges one product from each of two suppliers (BaumAuto at dukon and th-tool)', () => {
    expect(
      planAutoMerge([
        member('dukon-card', ['dukon']),
        member('th-card', ['th-tools'], {
          name: 'Съемник трехлапый универсальный (Ø захвата 125мм, глубина 90мм)',
        }),
      ]),
    ).toEqual({ targetId: 'dukon-card', duplicateIds: ['th-card'] });
  });

  it('never merges a supplier listing two products under one article (ABRO flavours)', () => {
    expect(
      planAutoMerge([
        member('lemon', ['th-tools']),
        member('coffee', ['th-tools']),
        member('b2bit-card', ['b2bit']),
      ]),
    ).toEqual({ skip: 'one-supplier-lists-several' });
  });

  it('calls prices more than 3x apart a conflict (JetaPro 1.64 vs 230.73)', () => {
    expect(
      planAutoMerge([
        member('cup', ['tools-by'], { priceValue: 1.64 }),
        member('other', ['dukon'], { priceValue: 230.73 }),
      ]),
    ).toEqual({ conflict: 'price', priceRatio: 140.69 });
  });

  it('calls titles of different kinds of item a conflict (Forsage F7205)', () => {
    expect(
      planAutoMerge([
        member('jack', ['dukon'], {
          name: 'Домкрат гидравлический профессиональный Forsage F7205',
        }),
        member('spreader', ['th-tools'], {
          name: 'Расширитель гидравлический 8т (2,5-107мм)',
        }),
      ]),
    ).toEqual({ conflict: 'names', priceRatio: 1 });
  });

  it('merges a dealer RRP above a retail price and keeps the dearer card (WorkPro)', () => {
    expect(
      planAutoMerge([
        member('dukon-knife', ['dukon'], { priceValue: 9.92 }),
        member('b2bit-knife', ['b2bit'], { priceValue: 15.49 }),
      ]),
    ).toEqual({ targetId: 'b2bit-knife', duplicateIds: ['dukon-knife'] });
  });

  it('ignores a product without a price when comparing prices', () => {
    expect(
      planAutoMerge([
        member('priced', ['dukon'], { priceValue: 10 }),
        member('draft', ['b2bit'], { priceValue: null, status: 'DRAFT' }),
      ]),
    ).toEqual({ targetId: 'priced', duplicateIds: ['draft'] });
  });

  it('never folds away or into what an admin hid or archived', () => {
    expect(
      planAutoMerge([
        member('live', ['dukon']),
        member('hidden', ['b2bit'], {
          status: 'HIDDEN',
          statusSource: 'ADMIN',
        }),
      ]),
    ).toEqual({ skip: 'admin-decided' });
  });

  it('keeps the card whose text we rewrote, and its URL', () => {
    expect(
      planAutoMerge([
        member('dearer', ['dukon'], { priceValue: 12 }),
        member('rewritten', ['th-tools'], { hasAiText: true }),
      ]),
    ).toEqual({ targetId: 'rewritten', duplicateIds: ['dearer'] });
  });

  it('keeps the card on sale first', () => {
    expect(
      planAutoMerge([
        member('draft', ['b2bit'], { status: 'DRAFT', priceValue: 20 }),
        member('live', ['dukon']),
      ]),
    ).toEqual({ targetId: 'live', duplicateIds: ['draft'] });
  });
});

describe('OffersService.autoMerge', () => {
  type Row = {
    id: string;
    name?: string;
    priceValue: number | null;
    sourceIds: string[];
  };

  function run(
    groups: Record<string, Row[]>,
    options: { limit?: number; dismissed?: string[] } = {},
  ) {
    const merge = jest.fn(() => Promise.resolve({}));
    const upsert = jest.fn(() => Promise.resolve({}));
    const deleteMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const prisma = {
      // Barcode keys first, then brand+sku keys.
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce(Object.keys(groups).map((key) => ({ key })))
        .mockResolvedValueOnce([]),
      mergeConflict: {
        findMany: jest.fn(() =>
          Promise.resolve(
            (options.dismissed ?? []).map((key) => ({
              signal: 'barcode',
              key,
            })),
          ),
        ),
        upsert,
        deleteMany,
      },
      product: {
        findMany: jest.fn(({ where }: { where: { matchBarcode: string } }) =>
          Promise.resolve(
            (groups[where.matchBarcode] ?? []).map((row) => ({
              id: row.id,
              name: row.name ?? 'Съемник трехлапый BaumAuto',
              status: 'PUBLISHED',
              statusSource: 'SYSTEM',
              priceValue: row.priceValue,
              aiLockedFields: [],
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
      .autoMerge(options.limit)
      .then((result) => ({ result, merge, recompute, upsert, deleteMany }));
  }

  it('merges what the plan allows and records a conflict for the admin', async () => {
    const { result, merge, recompute, upsert, deleteMany } = await run({
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
    expect(merge).toHaveBeenCalledWith('b', 'a');
    expect(recompute).toHaveBeenCalledWith('b');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { signal_key: { signal: 'barcode', key: '4811450262735' } },
        create: expect.objectContaining({
          reason: 'price',
          productIds: ['c', 'd'],
        }),
      }),
    );
    expect(result).toMatchObject({ groups: 2, merged: 1, conflicts: 1 });
    // A full pass: conflicts it no longer saw leave the list.
    expect(deleteMany).toHaveBeenCalled();
  });

  it('leaves a group an admin called «разные товары» alone', async () => {
    const { merge, upsert } = await run(
      {
        k1: [
          { id: 'a', priceValue: 10, sourceIds: ['dukon'] },
          { id: 'b', priceValue: 10, sourceIds: ['b2bit'] },
        ],
      },
      { dismissed: ['k1'] },
    );
    expect(merge).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('stops at the limit and keeps the conflict list as it is', async () => {
    const { result, merge, deleteMany } = await run(
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
      { limit: 1 },
    );
    expect(merge).toHaveBeenCalledTimes(1);
    expect(result.merged).toBe(1);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
