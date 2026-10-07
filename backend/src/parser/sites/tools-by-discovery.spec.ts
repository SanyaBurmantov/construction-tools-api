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
  const service = new ToolsByParserService(
    { sitemapsToolsBy: { upsert: enqueue } } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      getMaxPages: () => Promise.resolve(4),
      getRequestDelayMs: () => Promise.resolve(0),
    } as never,
    {} as never,
  );

  beforeEach(() => {
    fetchMock.mockReset();
    enqueue.mockReset();
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
});
