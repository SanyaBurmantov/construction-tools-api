import { ParserHttpError } from '../parser-http.error';
import { DukonParserService } from './dukon.parser';

type DiscoveryAccess = {
  fetchText: (url: string) => Promise<string>;
  enqueueUrls: (urls: string[]) => Promise<void>;
};

type CrawlPage = { url: string; failures?: number };
type CrawlRow = {
  state: { visitedPages: string[]; pageQueue: CrawlPage[] };
};

function crawlStore() {
  let state: CrawlRow['state'] | null = null;
  return {
    get state() {
      return state;
    },
    findUnique: jest.fn(() =>
      Promise.resolve(state ? { state: structuredClone(state) } : null),
    ),
    upsert: jest.fn(({ create }: { create: CrawlRow }) => {
      state = structuredClone(create.state);
      return Promise.resolve({ state });
    }),
    deleteMany: jest.fn(() => {
      state = null;
      return Promise.resolve({ count: 1 });
    }),
  };
}

function createService(crawl: ReturnType<typeof crawlStore>, maxPages = 100) {
  return new DukonParserService(
    {
      source: { upsert: () => Promise.resolve({ id: 'source-id' }) },
      parserCatalogCrawl: crawl,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      getMaxPages: () => Promise.resolve(maxPages),
      getRequestDelayMs: () => Promise.resolve(0),
    } as never,
    {} as never,
  );
}

function stubFetch(
  service: DukonParserService,
  handler: (url: string) => string | Promise<string>,
) {
  return jest
    .spyOn(service as unknown as DiscoveryAccess, 'fetchText')
    .mockImplementation(async (url) => handler(url));
}

function stubEnqueue(service: DukonParserService) {
  return jest
    .spyOn(service as unknown as DiscoveryAccess, 'enqueueUrls')
    .mockResolvedValue(undefined);
}

describe('Dukon discovery', () => {
  afterEach(() => jest.restoreAllMocks());

  it('walks the brand index and all PAGEN_2 pages of a brand', async () => {
    const crawl = crawlStore();
    const service = createService(crawl, 20);
    const fetch = stubFetch(service, (url) => {
      if (url === 'https://dukon.by/brands/') {
        return '<a href="/brands/nordberg/">Nordberg</a>';
      }
      if (url === 'https://dukon.by/catalog/') {
        return '<html></html>';
      }
      if (url === 'https://dukon.by/brands/nordberg/') {
        return `
          <div class="js-element" data-detail="/catalog/telezhki/one/"></div>
          <div class="ajaxpages"><a data-navpagecount="3"></a></div>`;
      }
      if (url.endsWith('?PAGEN_2=2')) {
        return '<div data-detail="/catalog/telezhki/two/"></div>';
      }
      if (url.endsWith('?PAGEN_2=3')) {
        return '<div data-detail="/catalog/telezhki/three/"></div>';
      }
      return '<html></html>';
    });
    const enqueue = stubEnqueue(service);

    const result = await service.discoverCatalogUrls();

    expect(result).toMatchObject({
      discoveredProducts: 3,
      remainingPages: 0,
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(
      expect.arrayContaining([
        'https://dukon.by/brands/nordberg/',
        'https://dukon.by/brands/nordberg/?PAGEN_2=2',
        'https://dukon.by/brands/nordberg/?PAGEN_2=3',
      ]),
    );
    expect(enqueue).toHaveBeenCalledWith([
      'https://dukon.by/catalog/telezhki/one/',
    ]);
    expect(enqueue).toHaveBeenCalledWith([
      'https://dukon.by/catalog/telezhki/three/',
    ]);
    // A completed pass clears the row, so the next run starts over.
    expect(crawl.state).toBeNull();
  });

  it('resumes an unfinished pass instead of restarting at the root', async () => {
    const crawl = crawlStore();
    const first = createService(crawl, 2);
    stubFetch(first, (url) => {
      if (url === 'https://dukon.by/brands/') {
        return '<a href="/brands/nordberg/">Nordberg</a>';
      }
      return '<html></html>';
    });
    stubEnqueue(first);

    await first.discoverCatalogUrls();
    expect(crawl.state?.pageQueue).toEqual([
      { url: 'https://dukon.by/brands/nordberg/' },
    ]);

    const second = createService(crawl, 10);
    const fetch = stubFetch(second, (url) => {
      if (url === 'https://dukon.by/brands/nordberg/') {
        return '<div data-detail="/catalog/telezhki/one/"></div>';
      }
      return '<html></html>';
    });
    stubEnqueue(second);

    await second.discoverCatalogUrls();

    expect(fetch).toHaveBeenCalledWith('https://dukon.by/brands/nordberg/');
    expect(crawl.state).toBeNull();
  });

  it('follows the catalogue categories as well as the brand index', async () => {
    const crawl = crawlStore();
    const service = createService(crawl, 20);
    const fetch = stubFetch(service, (url) => {
      if (url === 'https://dukon.by/brands/') return '<html></html>';
      if (url === 'https://dukon.by/catalog/') {
        return '<a class="psection" href="/catalog/instrumenty/">Инструменты</a>';
      }
      if (url === 'https://dukon.by/catalog/instrumenty/') {
        return '<div class="prod-list__item" data-detail="/catalog/instrumenty/drel/"></div>';
      }
      return '<html></html>';
    });
    stubEnqueue(service);

    const result = await service.discoverCatalogUrls();

    expect(fetch).toHaveBeenCalledWith('https://dukon.by/catalog/instrumenty/');
    expect(result.discoveredProducts).toBe(1);
  });

  it('keeps a transiently failing page for the next run without blocking the rest', async () => {
    const crawl = crawlStore();
    const service = createService(crawl, 20);
    const fetch = jest
      .spyOn(service as unknown as DiscoveryAccess, 'fetchText')
      .mockImplementation((url) => {
        if (url === 'https://dukon.by/brands/') {
          return Promise.reject(new Error('timeout'));
        }
        if (url === 'https://dukon.by/catalog/') {
          return Promise.resolve(
            '<a class="psection" href="/catalog/instrumenty/">Инструменты</a>',
          );
        }
        if (url === 'https://dukon.by/catalog/instrumenty/') {
          return Promise.resolve(
            '<div data-detail="/catalog/instrumenty/drel/"></div>',
          );
        }
        return Promise.resolve('<html></html>');
      });
    stubEnqueue(service);

    await expect(service.discoverCatalogUrls()).rejects.toThrow('timeout');

    expect(fetch).toHaveBeenCalledWith('https://dukon.by/catalog/');
    expect(fetch).toHaveBeenCalledWith('https://dukon.by/catalog/instrumenty/');
    expect(crawl.state?.pageQueue).toEqual([
      { url: 'https://dukon.by/brands/', failures: 1 },
    ]);
  });

  it('drops a removed page instead of retrying it forever', async () => {
    const crawl = crawlStore();
    const service = createService(crawl, 20);
    stubFetch(service, (url) => {
      if (url === 'https://dukon.by/brands/') {
        throw new ParserHttpError(404, url);
      }
      return '<html></html>';
    });
    stubEnqueue(service);

    const result = await service.discoverCatalogUrls();

    expect(result).toMatchObject({ failedPages: 1, remainingPages: 0 });
    expect(crawl.state).toBeNull();
  });

  it('drops a catalogue page after repeated failures instead of blocking the pass', async () => {
    const crawl = crawlStore();
    const handler = (url: string) => {
      if (url === 'https://dukon.by/brands/') throw new Error('timeout');
      return '<html></html>';
    };

    const first = createService(crawl, 20);
    stubFetch(first, handler);
    stubEnqueue(first);
    await expect(first.discoverCatalogUrls()).rejects.toThrow('timeout');
    expect(crawl.state?.pageQueue).toEqual([
      { url: 'https://dukon.by/brands/', failures: 1 },
    ]);

    const second = createService(crawl, 20);
    stubFetch(second, handler);
    stubEnqueue(second);
    await expect(second.discoverCatalogUrls()).rejects.toThrow('timeout');
    expect(crawl.state?.pageQueue).toEqual([
      { url: 'https://dukon.by/brands/', failures: 2 },
    ]);

    // Third strike: the page is dropped, but the run still reports it so the
    // drop cannot pass as a healthy refresh.
    const third = createService(crawl, 20);
    stubFetch(third, handler);
    stubEnqueue(third);
    await expect(third.discoverCatalogUrls()).rejects.toThrow(
      'dropped after 3 failures',
    );
    expect(crawl.state).toBeNull();
  });

  it('keeps the fifth consecutive failing page in the saved state', async () => {
    const crawl = crawlStore();
    const urls = Array.from(
      { length: 6 },
      (_, index) => `https://dukon.by/catalog/page-${index + 1}/`,
    );
    await crawl.upsert({
      create: {
        sourceCode: 'dukon',
        state: { visitedPages: [], pageQueue: urls.map((url) => ({ url })) },
      },
    } as never);

    const service = createService(crawl, 20);
    stubFetch(service, () => {
      throw new Error('timeout');
    });
    stubEnqueue(service);

    await expect(service.discoverCatalogUrls()).rejects.toThrow('timeout');

    // The fifth failure is deferred (not lost) before the exception, and the
    // sixth page stays queued: the next run can continue from here.
    expect(crawl.state?.pageQueue.map((entry) => entry.url).sort()).toEqual(
      [...urls].sort(),
    );
    expect(crawl.state?.pageQueue).toContainEqual({
      url: urls[4],
      failures: 1,
    });
    expect(crawl.state?.pageQueue).toContainEqual({ url: urls[5] });
  });

  it('does not rewrite the crawl state for failures before the first checkpoint', async () => {
    const crawl = crawlStore();
    const service = createService(crawl, 20);
    stubFetch(service, (url) => {
      if (url === 'https://dukon.by/brands/') throw new Error('timeout');
      return '<html></html>';
    });
    stubEnqueue(service);

    await expect(service.discoverCatalogUrls()).rejects.toThrow('timeout');

    // One write for the seed and one on the way out; the old `% 0` check
    // rewrote the whole blob on every failure before the first success.
    expect(crawl.upsert).toHaveBeenCalledTimes(2);
  });
});

describe('Dukon sitemap fallback and health', () => {
  it('continues catalog discovery when the sitemap is unavailable', async () => {
    const crawl = crawlStore();
    const service = createService(crawl, 20);
    stubFetch(service, (url) => {
      if (url.includes('sitemap-iblock-7.xml')) {
        throw new Error('Sitemap HTTP 404');
      }
      if (url === 'https://dukon.by/brands/') {
        return '<a href="/brands/nordberg/">Nordberg</a>';
      }
      if (url === 'https://dukon.by/brands/nordberg/') {
        return '<div data-detail="/catalog/nordberg/tovar/"></div>';
      }
      return '<html></html>';
    });
    stubEnqueue(service);
    jest.spyOn(service, 'getQueueStats').mockResolvedValue({
      queued: 1,
      visited: 0,
      failed: 0,
      skipped: 0,
      total: 1,
    });

    await expect(service.refreshSitemaps()).resolves.toMatchObject({
      queued: 1,
    });
  });

  it('fails the refresh when the crawl walks pages but extracts no products', async () => {
    const crawl = crawlStore();
    const service = createService(crawl, 20);
    stubFetch(service, (url) => {
      if (url === 'https://dukon.by/brands/') {
        return '<a href="/brands/nordberg/">Nordberg</a>';
      }
      if (url === 'https://dukon.by/catalog/') {
        return '<a class="psection" href="/catalog/instrumenty/">Инструменты</a>';
      }
      return '<html></html>';
    });
    stubEnqueue(service);

    await expect(service.refreshSitemaps()).rejects.toThrow(
      'found no product links',
    );
  });

  it('stays quiet when the crawl did extract products', async () => {
    const crawl = crawlStore();
    const service = createService(crawl, 20);
    stubFetch(service, (url) => {
      if (url.includes('sitemap-iblock-7.xml')) {
        return '<urlset></urlset>';
      }
      if (url === 'https://dukon.by/brands/') {
        return '<a href="/brands/nordberg/">Nordberg</a>';
      }
      if (url === 'https://dukon.by/brands/nordberg/') {
        return '<div data-detail="/catalog/nordberg/tovar/"></div>';
      }
      return '<html></html>';
    });
    stubEnqueue(service);
    jest.spyOn(service, 'getQueueStats').mockResolvedValue({
      queued: 1,
      visited: 0,
      failed: 0,
      skipped: 0,
      total: 1,
    });

    await expect(service.refreshSitemaps()).resolves.toMatchObject({
      queued: 1,
    });
  });
});

describe('Dukon batch monitoring', () => {
  it('reports saved, skipped, failed and delisted items for a completed batch', async () => {
    const prisma = {
      // The batch claims its rows (UPDATE … RETURNING url).
      $queryRaw: () =>
        Promise.resolve(
          ['saved', 'skipped', 'failed', 'deleted'].map((url) => ({ url })),
        ),
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
