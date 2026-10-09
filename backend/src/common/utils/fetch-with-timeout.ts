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
};

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
        lastError = new Error(`Retryable HTTP ${res.status} for ${url}`);
        await sleep(retryDelay(attempt, retryBaseMs, res));
        continue;
      }

      return res;
    } catch (error) {
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
  throw new Error(
    `Failed to fetch ${url} after ${retries + 1} attempts (timeout ${timeoutMs}ms): ${reason}`,
    { cause: lastError },
  );
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
