import { DukonParserService } from './dukon.parser';

type DiscoveryAccess = {
  fetchText: (url: string) => Promise<string>;
  enqueueUrls: (urls: string[]) => Promise<void>;
};

describe('Dukon discovery coverage and sitemap fallback', () => {
  const service = new DukonParserService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  afterEach(() => jest.restoreAllMocks());

  it('crawls the entire catalog rather than only tool sets', async () => {
    const crawl = jest
      .spyOn(service, 'discoverCatalogBranch')
      .mockResolvedValue({ visitedPages: 2, discoveredProducts: 12 });
    expect(await service.discoverCatalogUrls()).toEqual({
      visitedPages: 2,
      discoveredProducts: 12,
    });
    expect(crawl).toHaveBeenCalledWith('https://dukon.by/catalog/');
  });

  it('continues catalog discovery when the sitemap is unavailable', async () => {
    jest
      .spyOn(service as unknown as DiscoveryAccess, 'fetchText')
      .mockRejectedValue(new Error('Sitemap HTTP 404'));
    jest
      .spyOn(service, 'discoverCatalogUrls')
      .mockResolvedValue({ visitedPages: 2, discoveredProducts: 12 });
    const stats = { queued: 12, visited: 0, failed: 0, skipped: 0, total: 12 };
    jest.spyOn(service, 'getQueueStats').mockResolvedValue(stats);
    expect(await service.refreshSitemaps()).toEqual(stats);
  });

  it('keeps the refresh failed if neither source discovers any products', async () => {
    jest
      .spyOn(service as unknown as DiscoveryAccess, 'fetchText')
      .mockRejectedValue(new Error('Sitemap HTTP 404'));
    jest
      .spyOn(service, 'discoverCatalogUrls')
      .mockResolvedValue({ visitedPages: 1, discoveredProducts: 0 });
    await expect(service.refreshSitemaps()).rejects.toThrow('Sitemap HTTP 404');
  });

  // Both legs of the crawl match on theme classes, so a re-theme shows up as
  // pages walked with nothing extracted. With a working sitemap that used to
  // record SUCCESS, leaving a stalled catalogue as the only symptom.
  it('fails the refresh when the crawl walks pages but extracts no products', async () => {
    jest
      .spyOn(service as unknown as DiscoveryAccess, 'fetchText')
      .mockResolvedValue('<urlset></urlset>');
    jest
      .spyOn(service as unknown as DiscoveryAccess, 'enqueueUrls')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service, 'discoverCatalogUrls')
      .mockResolvedValue({ visitedPages: 40, discoveredProducts: 0 });

    await expect(service.refreshSitemaps()).rejects.toThrow(
      'walked 40 pages and found no product links',
    );
  });

  it('stays quiet when the crawl did extract products', async () => {
    jest
      .spyOn(service as unknown as DiscoveryAccess, 'fetchText')
      .mockResolvedValue('<urlset></urlset>');
    jest
      .spyOn(service as unknown as DiscoveryAccess, 'enqueueUrls')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service, 'discoverCatalogUrls')
      .mockResolvedValue({ visitedPages: 40, discoveredProducts: 7 });
    const stats = { queued: 7, visited: 0, failed: 0, skipped: 0, total: 7 };
    jest.spyOn(service, 'getQueueStats').mockResolvedValue(stats);

    expect(await service.refreshSitemaps()).toEqual(stats);
  });
});

describe('Dukon batch monitoring', () => {
  it('reports saved, skipped, failed and deleted items for a completed batch', async () => {
    const prisma = {
      sitemapsDukon: {
        findMany: () =>
          Promise.resolve(
            ['saved', 'skipped', 'failed', 'deleted'].map((url) => ({ url })),
          ),
      },
    };
    const settings = { getRequestDelayMs: () => Promise.resolve(0) };
    const service = new DukonParserService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      settings as never,
      {} as never,
    );
    jest
      .spyOn(service, 'cleanupStoredProductImages')
      .mockResolvedValue({ count: 0 });
    jest.spyOn(service, 'publishDraftProducts').mockResolvedValue({ count: 0 });
    jest.spyOn(service, 'getQueueStats').mockResolvedValue({
      queued: 0,
      visited: 1,
      skipped: 2,
      failed: 1,
      total: 4,
    });
    jest
      .spyOn(service, 'processSitemapUrl')
      .mockResolvedValueOnce('DONE')
      .mockResolvedValueOnce('SKIPPED')
      .mockResolvedValueOnce('FAILED')
      .mockResolvedValueOnce('DELISTED');
    expect((await service.processSitemapsBatch(4, 1)).batch).toEqual({
      processed: 4,
      saved: 1,
      skipped: 1,
      failed: 1,
      delisted: 1,
    });
  });
});
