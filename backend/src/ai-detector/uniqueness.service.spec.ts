import type { CompetitorSearchResult } from './competitors.service';
import { UniquenessService, uniquenessForSeo } from './uniqueness.service';

const noCompetitors = { search: jest.fn(() => Promise.resolve(null)) };

const supplierText =
  'Аккумуляторный перфоратор предназначен для сверления отверстий в бетоне, кирпиче и камне. ' +
  'Бесщеточный двигатель обеспечивает высокую производительность и долгий срок службы.';

function build(rows: {
  product?: unknown[];
  supplier?: unknown[];
  siblings?: unknown[];
  catalogue?: unknown[];
  offers?: unknown[];
}) {
  const queryRaw = jest.fn();
  const tx = {
    $executeRawUnsafe: jest.fn(() => Promise.resolve(0)),
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce(rows.catalogue ?? [])
      .mockResolvedValueOnce(rows.offers ?? []),
  };
  const prisma = {
    productRedirect: { findUnique: jest.fn(() => Promise.resolve(null)) },
    $queryRaw: queryRaw,
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  // Our product page: the product, its supplier texts, its siblings.
  queryRaw
    .mockResolvedValueOnce(rows.product ?? [])
    .mockResolvedValueOnce(rows.supplier ?? [])
    .mockResolvedValueOnce(rows.siblings ?? []);
  const competitors = {
    search: jest.fn(() =>
      Promise.resolve<CompetitorSearchResult>({
        pages: [],
        notes: ['21vek.by: товар не найден'],
        warnings: [],
      }),
    ),
  };
  return {
    service: new UniquenessService(prisma as never, competitors as never),
    prisma,
    tx,
    competitors,
  };
}

describe('UniquenessService', () => {
  it('our product page: compares with its supplier text and leaves the product itself out', async () => {
    const { service, tx, competitors } = build({
      product: [
        {
          id: 'p1',
          slug: 'perforator',
          name: 'Перфоратор',
          categoryId: 'c1',
          brand: 'WORTEX',
          full: supplierText,
          short: null,
        },
      ],
      supplier: [
        {
          id: 'o1',
          name: 'Перфоратор X',
          url: 'https://th-tool.by/perforator/',
          source: 'th-tool.by',
          description: supplierText,
        },
      ],
    });
    const report = await service.check(supplierText, {
      url: 'https://gost.by/product/perforator',
    });
    expect(report.percent).toBe(0);
    expect(report.matches[0]).toMatchObject({
      kind: 'supplier',
      supplier: 'th-tool.by',
      url: 'https://th-tool.by/perforator/',
      share: 100,
    });
    expect(report.scope[0]).toMatch(/текст поставщика/);
    // The catalogue search excludes the product being checked.
    const values = (tx.$queryRaw.mock.calls[0] as unknown[]).slice(1);
    expect(JSON.stringify(values)).toContain('p1');
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringMatching(/statement_timeout/),
    );
    // The competitors are asked for the product by its own name.
    expect(competitors.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'Перфоратор' }),
    );
  });

  it('competitor cards are compared and named', async () => {
    const { service, competitors } = build({});
    competitors.search.mockResolvedValueOnce({
      pages: [
        {
          competitor: '21vek.by',
          url: 'https://www.21vek.by/hammer_drills/x.html',
          title: 'Перфоратор X',
          text: `Меню Каталог ${supplierText} Отзывы`,
        },
      ],
      notes: ['21vek.by: карточек 1'],
      warnings: [],
    });
    const report = await service.check(supplierText, {
      productName: 'Перфоратор WORTEX CRH 1810',
    });
    expect(report.percent).toBe(0);
    expect(report.matches[0]).toMatchObject({
      kind: 'competitor',
      title: '21vek.by: Перфоратор X',
      share: 100,
    });
    expect(report.scope.join(' ')).toMatch(
      /конкуренты по запросу «WORTEX CRH 1810»/,
    );
  });

  it('pasted text: finds a copy in the catalogue by phrase', async () => {
    const queryRaw = jest.fn();
    const tx = {
      $executeRawUnsafe: jest.fn(() => Promise.resolve(0)),
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'p2',
            slug: 'drel',
            name: 'Дрель',
            full: supplierText,
            short: null,
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const prisma = {
      productRedirect: { findUnique: jest.fn() },
      $queryRaw: queryRaw,
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const report = await new UniquenessService(
      prisma as never,
      noCompetitors as never,
    ).check(supplierText);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(noCompetitors.search).not.toHaveBeenCalled();
    expect(report.scope.join(' ')).toMatch(/у конкурентов не искали/);
    expect(report.matches).toEqual([
      { kind: 'catalogue', title: 'Дрель', url: '/product/drel', share: 100 },
    ]);
  });

  it('a catalogue timeout degrades to a warning', async () => {
    const prisma = {
      productRedirect: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(() =>
        Promise.reject(
          new Error('canceling statement due to statement timeout'),
        ),
      ),
    };
    const report = await new UniquenessService(
      prisma as never,
      noCompetitors as never,
    ).check(supplierText);
    expect(report.percent).toBe(100);
    expect(report.warnings.join(' ')).toMatch(/не успел/);
  });

  it('the SEO role never sees which supplier or its address', () => {
    const seo = uniquenessForSeo({
      percent: 0,
      contentWords: 10,
      matches: [
        {
          kind: 'supplier',
          title: 'Текст поставщика: X',
          url: 'https://th-tool.by/x/',
          supplier: 'th-tool.by',
          share: 100,
        },
        { kind: 'catalogue', title: 'Дрель', url: '/product/drel', share: 50 },
      ],
      spans: [],
      scope: [],
      warnings: [],
    });
    expect(seo.matches[0]).toEqual({
      kind: 'supplier',
      title: 'Текст поставщика',
      url: null,
      share: 100,
    });
    expect(seo.matches[1]).toMatchObject({ url: '/product/drel' });
  });
});
