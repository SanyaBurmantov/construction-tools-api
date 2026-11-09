import { AiEntity } from '@prisma/client';
import { UniquenessService } from '../ai-detector/uniqueness.service';
import { minUniqueness, rewriteVerdict } from './ai-rewrite-checks';
import { AiRewriteChecksService } from './ai-rewrite-checks.service';

const supplier =
  'Набор ключей накидных TOPTUL состоит из 10 инструментов размером 6х7, 8х9, 10х11, 12х13 мм серии AAEI0607-2427. ' +
  'Все ключи изогнуты на 75 градусов для работы в труднодоступных местах. Изготовлены из хром-ванадиевой стали.';
// What DeepSeek wrote for it on prod: the supplier's text, reshuffled.
const reshuffled =
  'Набор накидных ключей TOPTUL GRAI1001 состоит из 10 инструментов размерами 6х7, 8х9, 10х11, 12х13 мм серии AAEI0607-2427. ' +
  'Все ключи изогнуты на 75 градусов для работы в труднодоступных местах. Изготовлены из хром-ванадиевой стали.';
const rewritten =
  'Десять накидных ключей TOPTUL от 6х7 до 12х13 мм: изгиб 75 градусов позволяет достать гайку там, ' +
  'куда прямой ключ не пролезает. Материал — хром-ванадиевая сталь, которая держит усилие без деформации.';

describe('rewriteVerdict', () => {
  it('refuses a description below the threshold and keeps the copied pieces', () => {
    const v = rewriteVerdict(
      {
        descriptionFull: { uniqueness: 14, ai: 0.98 },
        descriptionShort: { uniqueness: 90 },
      },
      { descriptionFull: ['состоит из 10 инструментов'] },
      50,
    );
    expect(v.rejected.descriptionFull).toMatch(/уникальность 14%.*от 50%/);
    expect(v.rejected.descriptionShort).toBeUndefined();
    expect(v.copied.descriptionFull).toEqual(['состоит из 10 инструментов']);
    expect(v.quality.descriptionFull.ai).toBe(0.98);
  });

  it('0 turns the gate off; no figure, no verdict', () => {
    expect(
      rewriteVerdict({ descriptionFull: { uniqueness: 5 } }, {}, 0).rejected,
    ).toEqual({});
    expect(
      rewriteVerdict({ descriptionFull: { uniqueness: null } }, {}, 50)
        .rejected,
    ).toEqual({});
  });

  it('reads AI_MIN_UNIQUENESS', () => {
    expect(minUniqueness(undefined)).toBe(50);
    expect(minUniqueness('70')).toBe(70);
    expect(minUniqueness('0')).toBe(0);
    expect(minUniqueness('abc')).toBe(50);
  });
});

describe('AiRewriteChecksService', () => {
  function build(detector = { configured: true, scoreMany: jest.fn() }) {
    const tx = {
      $executeRawUnsafe: jest.fn(() => Promise.resolve(0)),
      $queryRaw: jest.fn(() => Promise.resolve([])),
    };
    const prisma = {
      // The product's supplier offers.
      $queryRaw: jest.fn(() =>
        Promise.resolve([
          {
            id: 'o1',
            name: 'Набор ключей TOPTUL',
            url: 'https://tools.by/1',
            source: 'Tools.by',
            description: supplier,
          },
        ]),
      ),
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const uniqueness = new UniquenessService(prisma as never, {} as never);
    return {
      service: new AiRewriteChecksService(uniqueness, detector as never),
      detector,
    };
  }

  it('a reshuffled supplier text is refused, a real rewrite passes, the detector figure is kept', async () => {
    const detector = {
      configured: true,
      scoreMany: jest.fn(() =>
        Promise.resolve([{ probability: 0.991 }, { probability: 0.87 }]),
      ),
    };
    const { service } = build(detector);
    const result = await service.check([
      {
        entityId: 'p1',
        entity: AiEntity.PRODUCT,
        proposed: { descriptionFull: reshuffled },
        previous: [],
      },
      {
        entityId: 'p2',
        entity: AiEntity.PRODUCT,
        proposed: { descriptionFull: rewritten },
        previous: [supplier],
      },
    ]);
    expect(result.get('p1')!.rejected.descriptionFull).toMatch(/уникальность/);
    expect(result.get('p1')!.copied.descriptionFull?.[0]).toMatch(
      /изогнуты на 75 градусов/,
    );
    expect(result.get('p1')!.quality.descriptionFull.ai).toBe(0.991);
    expect(result.get('p2')!.rejected).toEqual({});
    expect(
      result.get('p2')!.quality.descriptionFull.uniqueness,
    ).toBeGreaterThan(80);
  });

  it('a detector that is off or failing only leaves its figure out', async () => {
    const { service } = build({
      configured: true,
      scoreMany: jest.fn(() => Promise.reject(new Error('down'))),
    });
    const result = await service.check([
      {
        entityId: 'p1',
        entity: AiEntity.PRODUCT,
        proposed: { descriptionFull: rewritten },
        previous: [],
      },
    ]);
    expect(result.get('p1')!.quality.descriptionFull.ai).toBeUndefined();
    expect(result.get('p1')!.quality.descriptionFull.uniqueness).not.toBeNull();
  });
});
