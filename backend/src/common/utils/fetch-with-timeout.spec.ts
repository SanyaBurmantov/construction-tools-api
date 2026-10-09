import { fetchWithTimeout } from './fetch-with-timeout';

describe('fetchWithTimeout', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('forwards an abort signal and resolves on success', async () => {
    let seenSignal: AbortSignal | null | undefined;
    global.fetch = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      seenSignal = init?.signal;
      return Promise.resolve(new Response('ok'));
    }) as typeof fetch;

    const res = await fetchWithTimeout('http://example.test', {}, 1000);

    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(await res.text()).toBe('ok');
  });

  it('aborts when the request exceeds the timeout', async () => {
    global.fetch = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as typeof fetch;

    await expect(
      fetchWithTimeout(
        'http://example.test',
        {},
        { timeoutMs: 10, retries: 0 },
      ),
    ).rejects.toThrow();
  });

  it('retries a retryable HTTP status and resolves on a later success', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithTimeout(
      'http://example.test',
      {},
      { retries: 2, retryBaseMs: 0 },
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors before succeeding', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(new Response('ok'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithTimeout(
      'http://example.test',
      {},
      { retries: 2, retryBaseMs: 0 },
    );

    expect(await res.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable client errors', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response('nope', { status: 404 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithTimeout(
      'http://example.test',
      {},
      { retries: 3, retryBaseMs: 0 },
    );

    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries and returns the last response', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response('busy', { status: 503 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithTimeout(
      'http://example.test',
      {},
      { retries: 2, retryBaseMs: 0 },
    );

    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('reports the failing URL, exhausted attempts and timeout while preserving the cause', async () => {
    const cause = new DOMException('This operation was aborted', 'AbortError');
    global.fetch = jest.fn().mockRejectedValue(cause) as typeof fetch;
    await expect(
      fetchWithTimeout(
        'https://tools.by/catalog/65',
        {},
        { timeoutMs: 20, retries: 2, retryBaseMs: 0 },
      ),
    ).rejects.toMatchObject({
      message:
        'Failed to fetch https://tools.by/catalog/65 after 3 attempts (timeout 20ms): This operation was aborted',
      cause,
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
