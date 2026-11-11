const DEFAULT_TIMEOUT_MS = Number(process.env.PARSER_FETCH_TIMEOUT_MS ?? 20000);
const DEFAULT_RETRIES = Number(process.env.PARSER_FETCH_RETRIES ?? 2);
const DEFAULT_RETRY_BASE_MS = Number(
  process.env.PARSER_FETCH_RETRY_BASE_MS ?? 500,
);
const MAX_RETRY_DELAY_MS = 15000;

/**
 * HTTP statuses worth retrying: rate limiting (429) and transient server
 * errors. Permanent client errors (404, 403, ...) are returned as-is so the
 * caller fails fast instead of hammering a dead URL.
 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export type FetchWithTimeoutOptions = {
  timeoutMs?: number;
  retries?: number;
  retryBaseMs?: number;
  /**
   * Refuse a body larger than this, *while* it downloads: a declared
   * Content-Length over it is refused before reading, and the stream is cut
   * the moment it passes it. Without it a body is buffered whole first — the
   * photo mirror held a 16 MiB «photo» in memory before its 15 MiB check
   * (audit 2026-11-03). Not retried: the same URL would be as big again.
   */
  maxBytes?: number;
};

/** The body passed `maxBytes`; the download was stopped there. */
export class ResponseTooLargeError extends Error {
  constructor(
    readonly url: string,
    readonly limit: number,
  ) {
    super(`Response from ${redactUrl(url)} is over ${limit} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * `fetch` with a hard timeout and bounded retries with exponential backoff.
 *
 * A hung supplier request would otherwise stall a parser cron indefinitely;
 * this aborts each attempt after `timeoutMs`. A single transient blip (timeout,
 * dropped connection, 429/5xx) would otherwise push a product URL straight to
 * `FAILED` and silently drop it from the catalog until a manual retry — so
 * transient failures are retried before giving up. Honors `Retry-After` when
 * the server sends it.
 *
 * The timeout covers the **body** too. The response is read in full before
 * the timer is cleared and handed back as a buffered `Response`, so the
 * caller's `res.text()` / `res.json()` resolve immediately. Clearing the timer
 * once headers arrived left the body read unbounded: a stalled stream (an LLM
 * that pads with whitespace and then hangs, a supplier dropping mid-page) hung
 * the parser batch or the AI runner until the process restarted.
 *
 * Backwards compatible: the third argument may still be a plain `timeoutMs`
 * number.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  options: number | FetchWithTimeoutOptions = {},
): Promise<Response> {
  const opts: FetchWithTimeoutOptions =
    typeof options === 'number' ? { timeoutMs: options } : options;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = Math.max(opts.retries ?? DEFAULT_RETRIES, 0);
  const retryBaseMs = Math.max(opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS, 0);

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });

      if (attempt < retries && RETRYABLE_STATUS.has(res.status)) {
        // Release the socket instead of leaving the unread body attached.
        await res.body?.cancel().catch(() => undefined);
        lastError = new Error(
          `Retryable HTTP ${res.status} for ${redactUrl(url)}`,
        );
        await sleep(retryDelay(attempt, retryBaseMs, res));
        continue;
      }

      return await bufferResponse(res, url, opts.maxBytes);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        controller.abort();
        throw error;
      }
      // Network error or timeout abort — retry while attempts remain.
      lastError = error;
      if (attempt >= retries) break;
      await sleep(retryDelay(attempt, retryBaseMs));
    } finally {
      clearTimeout(timer);
    }
  }

  const reason =
    typeof lastError === 'object' &&
    lastError !== null &&
    'message' in lastError &&
    typeof lastError.message === 'string'
      ? lastError.message
      : String(lastError);
  // undici says only «fetch failed»; the reason (ECONNREFUSED, a TLS error
  // from a proxy, a refused CONNECT) is on `cause` — the one thing worth
  // reading when a supplier or a proxy stops answering.
  const cause =
    typeof lastError === 'object' && lastError !== null && 'cause' in lastError
      ? describeCause(lastError.cause)
      : '';
  throw new Error(
    `Failed to fetch ${redactUrl(url)} after ${retries + 1} attempts (timeout ${timeoutMs}ms): ${reason}${cause && !reason.includes(cause) ? ` (${cause})` : ''}`,
    { cause: lastError },
  );
}

/**
 * Reads the body while the abort timer is still running and returns an
 * equivalent, already-buffered Response. `url` and `redirected` are kept —
 * a supplier redirecting a dead product to its home page is a signal.
 */
async function bufferResponse(
  res: Response,
  url: string,
  maxBytes?: number,
): Promise<Response> {
  const body = maxBytes
    ? await readCapped(res, url, maxBytes)
    : await res.arrayBuffer();
  const buffered = new Response(
    // A null-body status (204/304) must not be given a body.
    [101, 204, 205, 304].includes(res.status) ? null : body,
    { status: res.status, statusText: res.statusText, headers: res.headers },
  );
  Object.defineProperty(buffered, 'url', { value: res.url });
  Object.defineProperty(buffered, 'redirected', { value: res.redirected });
  return buffered;
}

async function readCapped(
  res: Response,
  url: string,
  maxBytes: number,
): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(url, maxBytes);
  }
  if (!res.body) return new ArrayBuffer(0);
  // The header can lie or be absent (chunked): count what actually arrives.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(url, maxBytes);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/**
 * The URL as it may appear in an error message: no query string and no
 * credential path segment. Telegram puts the bot token in the path
 * (`/bot<TOKEN>/sendMessage`), and these messages end up in container logs.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/bot[^/]+/, '/bot***');
    return `${parsed.origin}${path}`;
  } catch {
    return '[unparseable url]';
  }
}

/** `code: message` of an error's cause, without any URL it may carry. */
function describeCause(cause: unknown): string {
  if (typeof cause !== 'object' || cause === null) return '';
  const code =
    'code' in cause && typeof cause.code === 'string' ? cause.code : '';
  const message =
    'message' in cause && typeof cause.message === 'string'
      ? cause.message.replace(/[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)
      : '';
  return [code, message].filter(Boolean).join(': ');
}

function retryDelay(attempt: number, baseMs: number, res?: Response): number {
  const retryAfterMs = res
    ? parseRetryAfter(res.headers.get('retry-after'))
    : undefined;
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, MAX_RETRY_DELAY_MS);
  }

  const exponential = baseMs * 2 ** attempt;
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, MAX_RETRY_DELAY_MS);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(seconds, 0) * 1000;

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(dateMs - Date.now(), 0);

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
