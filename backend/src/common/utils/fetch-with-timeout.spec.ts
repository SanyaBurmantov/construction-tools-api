import { ResponseTooLargeError, fetchWithTimeout } from './fetch-with-timeout';

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

  it('says why fetch failed, without the URL the cause may carry', async () => {
    const failed = new TypeError('fetch failed', {
      cause: Object.assign(
        new Error(
          'connect ECONNREFUSED 10.0.0.1:8000 via http://u:p@10.0.0.1:8000',
        ),
        { code: 'ECONNREFUSED' },
      ),
    });
    global.fetch = jest
      .fn()
      .mockRejectedValue(failed) as unknown as typeof fetch;

    const run = fetchWithTimeout('https://th-tool.by/x', {}, { retries: 0 });
    await expect(run).rejects.toThrow(
      /fetch failed \(ECONNREFUSED: connect ECONNREFUSED 10\.0\.0\.1:8000 via \[url\]\)/,
    );
    await expect(run).rejects.not.toThrow(/u:p@/);
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
    // A fresh Response per call: a real fetch never hands out a consumed body.
    const fetchMock = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response('busy', { status: 503 })),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithTimeout(
      'http://example.test',
      {},
      { retries: 2, retryBaseMs: 0 },
    );

    expect(res.status).toBe(503);
    await expect(res.text()).resolves.toBe('busy');
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

  // The timer used to be cleared once headers arrived, leaving res.text()
  // unbounded on a stalled stream.
  it('times out a body that stalls after the headers', async () => {
    global.fetch = jest.fn((_url: string, init: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('partial'));
          init.signal?.addEventListener('abort', () =>
            controller.error(new Error('aborted')),
          );
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as unknown as typeof fetch;

    await expect(
      fetchWithTimeout(
        'http://example.test',
        {},
        { timeoutMs: 50, retries: 0 },
      ),
    ).rejects.toThrow('Failed to fetch');
  });

  it('keeps the bot token out of error messages', async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('ECONNRESET')),
    ) as unknown as typeof fetch;

    await expect(
      fetchWithTimeout(
        'https://api.telegram.org/bot123:SECRET/sendMessage?x=1',
        {},
        { retries: 0 },
      ),
    ).rejects.toThrow('https://api.telegram.org/bot***/sendMessage after');
  });

  describe('maxBytes', () => {
    const streamOf = (chunks: number[], onPull?: () => void) =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          onPull?.();
          const next = chunks.shift();
          if (next === undefined) controller.close();
          else controller.enqueue(new Uint8Array(next));
        },
      });

    it('refuses a declared Content-Length over the limit without reading it', async () => {
      let pulls = 0;
      global.fetch = jest.fn(() =>
        Promise.resolve(
          new Response(
            streamOf([10], () => pulls++),
            {
              headers: { 'content-length': String(20 * 1024 * 1024) },
            },
          ),
        ),
      ) as typeof fetch;
      await expect(
        fetchWithTimeout(
          'https://img.example/a.jpg',
          {},
          { maxBytes: 1024, retries: 2 },
        ),
      ).rejects.toBeInstanceOf(ResponseTooLargeError);
      expect(global.fetch).toHaveBeenCalledTimes(1); // not retried
      expect(pulls).toBeLessThanOrEqual(1);
    });

    it('cuts a stream that passes the limit while it arrives', async () => {
      let pulls = 0;
      // No Content-Length (chunked): 400 bytes a chunk, endless.
      global.fetch = jest.fn(() =>
        Promise.resolve(
          new Response(streamOf(Array(1000).fill(400), () => pulls++)),
        ),
      ) as typeof fetch;
      await expect(
        fetchWithTimeout('https://img.example/b.jpg', {}, { maxBytes: 1000 }),
      ).rejects.toBeInstanceOf(ResponseTooLargeError);
      expect(pulls).toBeLessThan(10);
    });

    it('returns a body within the limit intact', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve(new Response(streamOf([300, 300]), { status: 200 })),
      ) as typeof fetch;
      const res = await fetchWithTimeout(
        'https://img.example/c.jpg',
        {},
        { maxBytes: 1000 },
      );
      expect((await res.arrayBuffer()).byteLength).toBe(600);
    });
  });
});
