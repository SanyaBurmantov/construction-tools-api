import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { ToolsByParserService } from './tools-by-source.parser';
import { ThToolsParserService } from './th-tools-source.parser';
import { DukonParserService } from './dukon.parser';
import { Supplier7745ParserService } from './7745-source.parser';

jest.mock('../../common/utils/fetch-with-timeout', () => ({
  fetchWithTimeout: jest.fn(),
}));
const fetchMock = jest.mocked(fetchWithTimeout);
function deps() {
  const prisma = {
    source: { upsert: jest.fn(() => Promise.resolve({ id: 'source' })) },
    sourceCategory: {
      upsert: jest.fn(() =>
        Promise.resolve({ id: 'source-category', mappedCategoryId: 'mapped' }),
      ),
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    product: {
      findUnique: jest.fn(() => Promise.resolve({ status: 'ARCHIVED' })),
    },
    productSpecification: { upsert: jest.fn(() => Promise.resolve({})) },
    sourceProduct: { upsert: jest.fn(() => Promise.resolve({})) },
    sitemapsDukon: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
  };
  const offers = {
    onProductParsed: jest.fn(() => Promise.resolve()),
    delistOffer: jest.fn(() => Promise.resolve()),
  };
  const categoryTree = {
    upsertBranch: jest.fn(() => Promise.resolve({ id: 'generated' })),
  };
  const settings = {
    getCategoryFilters: () => Promise.resolve({ include: '', exclude: '' }),
  };
  const identity = {
    upsertBrand: jest.fn(() => Promise.resolve('brand')),
    findByOffer: jest.fn(() => Promise.resolve('product')),
    save: jest.fn(() => Promise.resolve({ id: 'product' })),
    upsertSpecification: jest.fn(() => Promise.resolve({ id: 'spec' })),
    // Characteristics are written by the identity service for every source, so
    // the canonical key and the normalized value cannot be forgotten by one
    // parser. See ProductIdentityService.saveSpecifications.
    saveSpecifications: jest.fn(() => Promise.resolve()),
  };
  const logs = { addError: jest.fn(() => Promise.resolve()) };
  return { prisma, offers, categoryTree, settings, identity, logs };
}
const cases = [
  {
    name: 'Tools.by',
    Parser: ToolsByParserService,
    fixture: 'tools-by-product.html',
    url: 'https://tools.by/product/1',
  },
  {
    name: 'TH-Tools',
    Parser: ThToolsParserService,
    fixture: 'th-tools-product.html',
    url: 'https://th-tool.by/product/',
  },
  {
    name: 'Dukon',
    Parser: DukonParserService,
    fixture: 'dukon-product.html',
    url: 'https://dukon.by/catalog/item/',
  },
  {
    name: '7745',
    Parser: Supplier7745ParserService,
    fixture: '7745-product.html',
    url: 'https://7745.by/product/item/',
  },
];

describe.each(cases)(
  '$name supplier synchronization',
  ({ Parser, fixture, url }) => {
    beforeEach(() => fetchMock.mockReset());
    it('updates the existing offer using mapped categories, preserving archived status and manual prices', async () => {
      const d = deps();
      const parser = new Parser(
        d.prisma as never,
        d.logs as never,
        d.offers as never,
        d.categoryTree as never,
        d.settings as never,
        d.identity as never,
      );
      fetchMock.mockResolvedValue(
        new Response(
          readFileSync(join(__dirname, 'fixtures', fixture), 'utf8'),
        ),
      );
      await parser.parseProductUrl(url);
      const save = d.identity.save.mock.calls[0] as unknown as [
        { data: { update: Record<string, unknown> }; url: string },
      ];
      expect(save[0].url).toBe(url);
      expect(save[0].data.update).toMatchObject({
        categoryId: 'mapped',
        name: expect.any(String) as string,
      });
      for (const field of ['priceValue', 'oldPrice', 'status'])
        expect(save[0].data.update).not.toHaveProperty(field);
      expect(d.categoryTree.upsertBranch).not.toHaveBeenCalled();
      expect(d.offers.onProductParsed).toHaveBeenCalledWith('product');
      const sourceWrite = d.prisma.sourceProduct.upsert.mock
        .calls[0] as unknown as [{ update: Record<string, unknown> }];
      expect(sourceWrite[0].update).toMatchObject({
        productId: 'product',
        sourceCategoryId: 'source-category',
        name: save[0].data.update.name,
      });
    });
  },
);

describe('Dukon offer lifecycle', () => {
  beforeEach(() => fetchMock.mockReset());
  it.each([404, 410])('withdraws deleted offers on HTTP %i', async (status) => {
    const d = deps();
    const parser = new DukonParserService(
      d.prisma as never,
      d.logs as never,
      d.offers as never,
      d.categoryTree as never,
      d.settings as never,
      d.identity as never,
    );
    fetchMock.mockResolvedValue(new Response(null, { status }));
    expect(
      await parser.processSitemapUrl('https://dukon.by/catalog/item/'),
    ).toBe('DELISTED');
    expect(d.offers.delistOffer).toHaveBeenCalledWith(
      'source',
      'https://dukon.by/catalog/item/',
    );
    expect(d.logs.addError).not.toHaveBeenCalled();
  });
  it('does not treat unknown stock as available', async () => {
    const d = deps();
    const parser = new DukonParserService(
      d.prisma as never,
      d.logs as never,
      d.offers as never,
      d.categoryTree as never,
      d.settings as never,
      d.identity as never,
    );
    const html = readFileSync(
      join(__dirname, 'fixtures', 'dukon-product.html'),
      'utf8',
    ).replace('https://schema.org/InStock', '');
    fetchMock.mockResolvedValue(new Response(html));
    await parser.parseProductUrl('https://dukon.by/catalog/item/');
    const write = d.prisma.sourceProduct.upsert.mock.calls[0] as unknown as [
      { update: { stock: boolean } },
    ];
    expect(write[0].update.stock).toBe(false);
  });
  it('respects disabled supplier branches before writing products', async () => {
    const d = deps();
    d.prisma.sourceCategory.findFirst.mockResolvedValue({
      name: 'Disabled',
    } as never);
    const parser = new DukonParserService(
      d.prisma as never,
      d.logs as never,
      d.offers as never,
      d.categoryTree as never,
      d.settings as never,
      d.identity as never,
    );
    fetchMock.mockResolvedValue(
      new Response(
        readFileSync(join(__dirname, 'fixtures', 'dukon-product.html'), 'utf8'),
      ),
    );
    expect(
      await parser.processSitemapUrl('https://dukon.by/catalog/item/'),
    ).toBe('SKIPPED');
    expect(d.identity.save).not.toHaveBeenCalled();
  });
});
