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
      fetchWithTimeout('http://example.test', {}, 10),
    ).rejects.toThrow();
  });
});
