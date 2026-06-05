const DEFAULT_TIMEOUT_MS = Number(process.env.PARSER_FETCH_TIMEOUT_MS ?? 20000);

/**
 * `fetch` with a hard timeout. A hung supplier request would otherwise stall a
 * parser cron indefinitely; this aborts the request after `timeoutMs`.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
