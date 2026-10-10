import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { ToolsByParserService } from './tools-by-source.parser';

jest.mock('../../common/utils/fetch-with-timeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

const fetchMock = jest.mocked(fetchWithTimeout);
const catalogUrl = 'https://tools.by/catalog/65';
const snapshot = (more: boolean, loaded = 25) =>
  JSON.stringify({
    memo: { name: 'catalog.catalog' },
    data: { show_more_button: more, loaded },
  });
const escapeAttr = (value: string) => value.replace(/"/g, '&quot;');
const product = (id: number) => `<a href="/product/${id}">Товар</a>`;
const listing = (more: boolean) => `
  <meta name="csrf-token" content="test-csrf">
  <div wire:snapshot="${escapeAttr(snapshot(more))}">${product(1)}</div>`;
const root = `<div wire:snapshot="${escapeAttr(
  JSON.stringify({
    memo: { name: 'catalog.filters' },
    data: {
      availableCategories: [
        { '65': [{ name: 'Электроинструмент' }, { s: 'arr' }] },
        { s: 'arr' },
      ],
    },
  }),
)}"></div><a href="/catalog/novelties">Новинки</a>`;

describe('Tools.by catalog discovery', () => {
  const enqueue = jest.fn();
  let state: unknown = null;
  const crawl = {
    findUnique: jest.fn(() => Promise.resolve(state ? { state } : null)),
    upsert: jest.fn(({ create }: { create: { state: unknown } }) => {
      state = structuredClone(create.state);
      return Promise.resolve({ state });
    }),
    deleteMany: jest.fn(() => {
      state = null;
      return Promise.resolve({ count: 1 });
    }),
  };
  const createService = (maxPages = 4) =>
    new ToolsByParserService(
      {
        sitemapsToolsBy: { upsert: enqueue },
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
  let service: ToolsByParserService;

  beforeEach(() => {
    fetchMock.mockReset();
    enqueue.mockReset();
    jest.clearAllMocks();
    state = null;
    service = createService();
  });

  it('discovers lazy menu categories and follows loadMore with the session and latest snapshot', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(root))
      .mockResolvedValueOnce(
        new Response(listing(true), {
          headers: { 'set-cookie': 'session=test; Path=/' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            components: [
              {
                snapshot: snapshot(true, 50),
                effects: {
                  html: '<button wire:click="loadMore">Ещё</button>',
                  dispatches: [
                    { name: 'dataRetrieved', params: { htmlData: product(2) } },
                  ],
                },
              },
            ],
          },
          { headers: { 'set-cookie': 'session=renewed; Path=/' } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          components: [
            {
              snapshot: snapshot(false, 75),
              effects: {
                html: '<div></div>',
                dispatches: [
                  { name: 'dataRetrieved', params: { htmlData: product(3) } },
                ],
              },
            },
          ],
        }),
      );

    const result = await service.discoverCatalogUrls();
    expect(result.discoveredProducts).toBe(3);
    expect(result.visitedPages).toBe(4);
    expect(result.remainingPages).toBe(0);
    expect(fetchMock.mock.calls[1][0]).toBe(catalogUrl);
    const firstUpdate = fetchMock.mock.calls[2][1]!;
    expect(firstUpdate.headers).toMatchObject({
      cookie: 'session=test',
      referer: catalogUrl,
    });
    expect(JSON.parse(firstUpdate.body as string)).toEqual({
      _token: 'test-csrf',
      components: [
        {
          snapshot: snapshot(true),
          updates: {},
          calls: [{ path: '', method: 'loadMore', params: [] }],
        },
      ],
    });
    expect(fetchMock.mock.calls[3][1]!.headers).toMatchObject({
      cookie: 'session=renewed',
    });
    const updatedBody = JSON.parse(
      fetchMock.mock.calls[3][1]!.body as string,
    ) as {
      components: Array<{ snapshot: string }>;
    };
    expect(updatedBody.components[0].snapshot).toBe(snapshot(true, 50));
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { url: 'https://tools.by/product/3', status: 'PENDING' },
      }),
    );
  });

  it('retains linked pagination, deduplicates filters and rejects offsite catalog links', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(`
        <a href="/catalog/65?page=2&sorting=name#items">2</a>
        <a href="/catalog/65?brand_id=1">Бренд</a>
        <a href="https://example.org/catalog/65">Другой сайт</a>`),
      )
      .mockResolvedValueOnce(new Response(product(2)))
      .mockResolvedValueOnce(new Response(product(1)));
    await service.discoverCatalogUrls();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://tools.by/catalog',
      'https://tools.by/catalog/65?page=2',
      catalogUrl,
    ]);
  });

  it('stops at the configured request budget and reports remaining pages', async () => {
    // Both updates return genuinely new product URLs, but keep the more button.
    fetchMock
      .mockResolvedValueOnce(new Response(root))
      .mockResolvedValueOnce(new Response(listing(true)))
      .mockResolvedValueOnce(
        Response.json({
          components: [
            { snapshot: snapshot(true, 50), effects: { html: product(2) } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          components: [
            { snapshot: snapshot(true, 75), effects: { html: product(3) } },
          ],
        }),
      );
    const result = await service.discoverCatalogUrls();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.remainingPages).toBe(1);
  });

  it('reports a broken dynamic response instead of silently importing only the first page', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(root))
      .mockResolvedValueOnce(new Response(listing(true)))
      .mockResolvedValueOnce(Response.json({ components: [] }));
    await expect(service.discoverCatalogUrls()).rejects.toThrow(
      'no catalog HTML',
    );
  });
  it('resumes loadMore after a service restart without repeating the catalog prefix', async () => {
    fetchMock.mockResolvedValueOnce(new Response(root)).mockResolvedValueOnce(
      new Response(listing(true), {
        headers: { 'set-cookie': 'session=saved; Path=/' },
      }),
    );
    expect(await createService(2).discoverCatalogUrls()).toMatchObject({
      visitedPages: 2,
      remainingPages: 1,
    });
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        components: [
          { snapshot: snapshot(false, 50), effects: { html: product(2) } },
        ],
      }),
    );
    const result = await createService(2).discoverCatalogUrls();
    expect(result).toMatchObject({ visitedPages: 1, remainingPages: 0 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://tools.by/livewire/update');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      cookie: 'session=saved',
    });
    expect(state).toBeNull();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response(''));
    await createService(2).discoverCatalogUrls();
    expect(fetchMock.mock.calls[0][0]).toBe('https://tools.by/catalog');
  });

  it('resumes ordinary category pages and keeps visited links deduplicated across runs', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(`
      <a href="/catalog/65">A</a><a href="/catalog/66">B</a>`),
    );
    await createService(1).discoverCatalogUrls();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response('<a href="/catalog/66">B</a>' + product(1)),
      )
      .mockResolvedValueOnce(
        new Response('<a href="/catalog/65">A</a>' + product(2)),
      );
    expect(await createService().discoverCatalogUrls()).toMatchObject({
      visitedPages: 2,
      remainingPages: 0,
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      catalogUrl,
      'https://tools.by/catalog/66',
    ]);
  });

  it('retries the failing page after a timeout without discarding the remaining queue', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(root))
      .mockRejectedValueOnce(new Error('This operation was aborted'));
    await expect(service.discoverCatalogUrls()).rejects.toThrow('aborted');
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response(product(1)));
    expect(await createService().discoverCatalogUrls()).toMatchObject({
      remainingPages: 0,
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([catalogUrl]);
  });

  // The state is a single JSON blob: every URL visited so far in the pass plus
  // the queue, each paginating entry carrying its ~4 KB Livewire snapshot. It
  // used to be re-serialised and upserted after every page, so a 2000-page run
  // rewrote a multi-megabyte blob 2000 times, growing as the pass progressed.
  it('does not rewrite the crawl state once per fetched page', async () => {
    const manyCategories = `<div wire:snapshot="${escapeAttr(
      JSON.stringify({
        memo: { name: 'catalog.filters' },
        data: {
          availableCategories: [
            Object.fromEntries(
              ['65', '26', '98', '4199', '920359'].map((id) => [
                id,
                [{ name: id }, { s: 'arr' }],
              ]),
            ),
            { s: 'arr' },
          ],
        },
      }),
    )}"></div>`;
    // A fresh Response per call: a body can only be read once.
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(listing(false))),
    );
    fetchMock.mockResolvedValueOnce(new Response(manyCategories));

    // 4 pages fetched, and the queue still holds the categories not reached.
    const result = await createService(4).discoverCatalogUrls();
    expect(result.visitedPages).toBe(4);
    expect(result.remainingPages).toBeGreaterThan(0);

    // One write before the first fetch and one on the way out — not four.
    expect(crawl.upsert).toHaveBeenCalledTimes(2);
  });

  it('replays the page if saving its URLs fails before committing the checkpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(root))
      .mockResolvedValueOnce(new Response(product(1)));
    enqueue.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.discoverCatalogUrls()).rejects.toThrow(
      'database unavailable',
    );
    enqueue.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response(product(1)));
    await createService().discoverCatalogUrls();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([catalogUrl]);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('renews an expired session without resetting pagination and counts renewal against the budget', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(root))
      .mockResolvedValueOnce(new Response(listing(true)));
    await createService(2).discoverCatalogUrls();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 419 }))
      .mockResolvedValueOnce(
        new Response(listing(true), {
          headers: { 'set-cookie': 'session=fresh; Path=/' },
        }),
      );
    expect(await createService(2).discoverCatalogUrls()).toMatchObject({
      visitedPages: 2,
      remainingPages: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        components: [
          { snapshot: snapshot(false, 50), effects: { html: product(2) } },
        ],
      }),
    );
    await createService().discoverCatalogUrls();
    const options = fetchMock.mock.calls[0][1]!;
    expect(options.headers).toMatchObject({ cookie: 'session=fresh' });
    const body = JSON.parse(options.body as string) as {
      components: Array<{ snapshot: string }>;
    };
    expect(body.components[0].snapshot).toBe(snapshot(true));
  });

  it('does not silently discard a broken loadMore response on subsequent runs', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(root))
      .mockResolvedValueOnce(new Response(listing(true)))
      .mockResolvedValueOnce(Response.json({ components: [] }));
    await expect(service.discoverCatalogUrls()).rejects.toThrow(
      'no catalog HTML',
    );
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        components: [
          { snapshot: snapshot(false, 50), effects: { html: product(2) } },
        ],
      }),
    );
    await createService().discoverCatalogUrls();
    expect(fetchMock.mock.calls[0][0]).toBe('https://tools.by/livewire/update');
  });
  it('uses a longer catalog timeout and honors the catalog-specific override', async () => {
    const old = process.env.TOOLS_BY_CATALOG_FETCH_TIMEOUT_MS;
    try {
      delete process.env.TOOLS_BY_CATALOG_FETCH_TIMEOUT_MS;
      fetchMock
        .mockResolvedValueOnce(new Response(root))
        .mockResolvedValueOnce(new Response(listing(true)))
        .mockResolvedValueOnce(
          Response.json({
            components: [
              { snapshot: snapshot(false, 50), effects: { html: product(2) } },
            ],
          }),
        );
      await service.discoverCatalogUrls();
      expect(fetchMock.mock.calls.map((call) => call[2])).toEqual([
        { timeoutMs: 60000 },
        { timeoutMs: 60000 },
        { timeoutMs: 60000 },
      ]);
      fetchMock.mockReset();
      process.env.TOOLS_BY_CATALOG_FETCH_TIMEOUT_MS = '45000';
      fetchMock.mockResolvedValueOnce(new Response(''));
      await service.discoverCatalogUrls();
      expect(fetchMock.mock.calls[0][2]).toEqual({ timeoutMs: 45000 });
    } finally {
      if (old === undefined)
        delete process.env.TOOLS_BY_CATALOG_FETCH_TIMEOUT_MS;
      else process.env.TOOLS_BY_CATALOG_FETCH_TIMEOUT_MS = old;
    }
  });
});

describe('Tools.by refresh guards', () => {
  const upsertSource = jest.fn(() => Promise.resolve({ id: 'src' }));
  const createService = () => {
    const service = new ToolsByParserService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(
        service as unknown as { upsertSource: () => Promise<unknown> },
        'upsertSource',
      )
      .mockImplementation(upsertSource);
    return service;
  };

  afterEach(() => jest.restoreAllMocks());

  // A single empty category is normal; a whole run that fetched pages and
  // extracted nothing means the markup moved under us. Without this the run
  // records SUCCESS and the only symptom is a catalogue that stops growing.
  it('fails the refresh when a run walks pages but extracts no products', async () => {
    const service = createService();
    jest.spyOn(service, 'discoverCatalogUrls').mockResolvedValue({
      visitedPages: 12,
      maxPages: 2000,
      discoveredProducts: 0,
      remainingPages: 5,
    });

    await expect(service.refreshSitemaps()).rejects.toThrow(
      'walked 12 pages and found no product links',
    );
  });

  it('does not fail a run that had no pages left to fetch', async () => {
    const service = createService();
    jest.spyOn(service, 'discoverCatalogUrls').mockResolvedValue({
      visitedPages: 0,
      maxPages: 2000,
      discoveredProducts: 0,
      remainingPages: 0,
    });
    const stats = { queued: 0, visited: 9, failed: 0, skipped: 0, total: 9 };
    jest.spyOn(service, 'getQueueStats').mockResolvedValue(stats);

    await expect(service.refreshSitemaps()).resolves.toMatchObject(stats);
  });
});

describe('Tools.by product URL classification', () => {
  afterEach(() => jest.restoreAllMocks());

  // A catalogue or landing page has no product name either, so checking the
  // name first classified it FAILED rather than SKIPPED — which put it in the
  // error log and, because the watchdog requeues FAILED rows, had it refetched
  // every retry window indefinitely.
  it('skips a non-product page instead of failing it, even with no name', async () => {
    const service = new ToolsByParserService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(
        service as unknown as { fetchText: (u: string) => Promise<string> },
        'fetchText',
      )
      .mockResolvedValue('<html><body><h2>Каталог</h2></body></html>');

    await expect(
      service.parseProductUrl('https://tools.by/catalog/65'),
    ).rejects.toMatchObject({ name: 'SkippedToolsByProductError' });
  });
});
