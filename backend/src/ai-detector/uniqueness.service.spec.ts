import { UniquenessService, uniquenessForSeo } from './uniqueness.service';

const supplierText =
  'Аккумуляторный перфоратор предназначен для сверления отверстий в бетоне, кирпиче и камне. ' +
  'Бесщеточный двигатель обеспечивает высокую производительность и долгий срок службы.';

function build(rows: {
  product?: unknown[];
  supplier?: unknown[];
  siblings?: unknown[];
  catalogue?: unknown[];
}) {
  const queryRaw = jest.fn();
  const tx = {
    $executeRawUnsafe: jest.fn(() => Promise.resolve(0)),
    $queryRaw: jest.fn(() => Promise.resolve(rows.catalogue ?? [])),
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
  return { service: new UniquenessService(prisma as never), prisma, tx };
}

describe('UniquenessService', () => {
  it('our product page: compares with its supplier text and leaves the product itself out', async () => {
    const { service, tx } = build({
      product: [
        {
          id: 'p1',
          slug: 'perforator',
          name: 'Перфоратор',
          categoryId: 'c1',
          full: supplierText,
          short: null,
        },
      ],
      supplier: [
        {
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
  });

  it('pasted text: finds a copy in the catalogue by phrase', async () => {
    const queryRaw = jest.fn();
    const tx = {
      $executeRawUnsafe: jest.fn(() => Promise.resolve(0)),
      $queryRaw: jest.fn(() =>
        Promise.resolve([
          {
            id: 'p2',
            slug: 'drel',
            name: 'Дрель',
            full: supplierText,
            short: null,
          },
        ]),
      ),
    };
    const prisma = {
      productRedirect: { findUnique: jest.fn() },
      $queryRaw: queryRaw,
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const report = await new UniquenessService(prisma as never).check(
      supplierText,
    );
    expect(queryRaw).not.toHaveBeenCalled();
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
    const report = await new UniquenessService(prisma as never).check(
      supplierText,
    );
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
