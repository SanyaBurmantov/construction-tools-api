/**
 * Supplier connection state — pure rules, no I/O.
 *
 * Two suppliers stopped answering our server's IP in November 2026
 * (th-tool.by on 01.11, dukon.by on 09.11: ping fine, TCP 80/443 dropped).
 * Nothing on screen said so: every batch "finished" with `saved: 0,
 * failed: 150`, was recorded as SUCCESS and took 90 minutes of retries.
 * So every request to a supplier is now counted per route (direct / through
 * the proxy), a route that keeps failing is called BLOCKED, and in `auto`
 * mode a blocked direct route switches the source to the proxy by itself —
 * and back once the direct route answers again.
 */

export const CONNECTION_ROUTES = ['DIRECT', 'PROXY'] as const;
export type ConnectionRoute = (typeof CONNECTION_ROUTES)[number];

export const CONNECTION_STATES = [
  'UNKNOWN',
  'OK',
  'DEGRADED',
  'BLOCKED',
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

/** off = always direct, auto = proxy only while direct is blocked, always = always proxy. */
export const PROXY_MODES = ['off', 'auto', 'always'] as const;
export type ProxyMode = (typeof PROXY_MODES)[number];
export const DEFAULT_PROXY_MODE: ProxyMode = 'auto';

/**
 * Failures in a row before a route is called BLOCKED. One request is already
 * three attempts (fetchWithTimeout retries), so five in a row is ~15 refused
 * connections — a ban, not a blip. Idle, the probe alone gets there in 50 min.
 */
export const BLOCKED_AFTER_FAILURES = 5;

/**
 * - `ok`: the site answered (any status but 403/429 — a 404 is the site
 *   working and saying the product is gone);
 * - `denied`: 403 or 429 — an HTTP-level ban or rate limit;
 * - `unreachable`: no answer at all — connect timeout, refused, reset.
 */
export type ConnectionOutcome =
  | { kind: 'ok'; status: number; ms?: number }
  | { kind: 'denied'; status: number; ms?: number }
  | { kind: 'unreachable'; error: string; ms?: number };

export type RouteSnapshot = {
  state: ConnectionState;
  /** What the failures in a row were: no connection, or 403/429. */
  failureKind: 'UNREACHABLE' | 'DENIED' | null;
  consecutiveFailures: number;
  lastOkAt: Date | null;
  lastFailAt: Date | null;
  lastError: string | null;
  lastStatus: number | null;
  lastMs: number | null;
  blockedSince: Date | null;
};

export const emptySnapshot = (): RouteSnapshot => ({
  state: 'UNKNOWN',
  failureKind: null,
  consecutiveFailures: 0,
  lastOkAt: null,
  lastFailAt: null,
  lastError: null,
  lastStatus: null,
  lastMs: null,
  blockedSince: null,
});

export function classifyStatus(status: number): 'ok' | 'denied' {
  return status === 403 || status === 429 ? 'denied' : 'ok';
}

/** The route's state after one more request. */
export function applyOutcome(
  previous: RouteSnapshot,
  outcome: ConnectionOutcome,
  now: Date,
): RouteSnapshot {
  const ms = outcome.ms ?? null;
  if (outcome.kind === 'ok') {
    return {
      ...previous,
      state: 'OK',
      failureKind: null,
      consecutiveFailures: 0,
      lastOkAt: now,
      lastStatus: outcome.status,
      lastMs: ms,
      blockedSince: null,
    };
  }

  const consecutiveFailures = previous.consecutiveFailures + 1;
  const blocked = consecutiveFailures >= BLOCKED_AFTER_FAILURES;
  return {
    ...previous,
    state: blocked ? 'BLOCKED' : 'DEGRADED',
    failureKind: outcome.kind === 'denied' ? 'DENIED' : 'UNREACHABLE',
    consecutiveFailures,
    lastFailAt: now,
    lastError:
      outcome.kind === 'denied'
        ? `HTTP ${outcome.status}`
        : outcome.error.slice(0, 500),
    lastStatus: outcome.kind === 'denied' ? outcome.status : null,
    lastMs: ms,
    blockedSince: blocked ? (previous.blockedSince ?? now) : null,
  };
}

/** Which route a request of this source takes now. */
export function chooseRoute(
  mode: ProxyMode,
  proxyConfigured: boolean,
  direct: RouteSnapshot,
): ConnectionRoute {
  if (!proxyConfigured || mode === 'off') return 'DIRECT';
  if (mode === 'always') return 'PROXY';
  return direct.state === 'BLOCKED' ? 'PROXY' : 'DIRECT';
}

/** Is it worth starting a batch: the route it would take is not known to be blocked. */
export function isUsable(snapshot: RouteSnapshot) {
  return snapshot.state !== 'BLOCKED';
}

/** The source whose traffic a URL is — by host or any subdomain of it. */
export function sourceForUrl<T extends { code: string; host: string }>(
  url: string,
  sources: readonly T[],
): T | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
  return sources.find(
    (source) => host === source.host || host.endsWith(`.${source.host}`),
  );
}

/**
 * Checks a proxy address before it is stored. Only HTTP(S) proxies: the
 * request goes through `CONNECT`, which is what undici's ProxyAgent speaks.
 * Returns the normalized URL or throws with a message for the admin.
 */
export function normalizeProxyUrl(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'Адрес прокси не похож на URL — нужен вид http://логин:пароль@host:порт',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Поддерживаются только HTTP(S)-прокси, а не ${url.protocol.replace(':', '')}`,
    );
  }
  if (!url.hostname) throw new Error('В адресе прокси нет хоста');
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Адрес прокси — только схема, логин, пароль, хост и порт');
  }
  return `${url.protocol}//${url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''}${url.host}`;
}

/** The proxy as it may be shown or logged: the password never leaves the server. */
export function maskProxyUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const user = url.username
      ? `${decodeURIComponent(url.username)}${url.password ? ':***' : ''}@`
      : '';
    return `${url.protocol}//${user}${url.host}`;
  } catch {
    return '[некорректный адрес]';
  }
}
