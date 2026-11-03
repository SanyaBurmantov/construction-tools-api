/**
 * Timing of every API request, per route, in the API process's memory
 * (perf/request-timing.middleware.ts records, /admin/performance reads).
 * Pure and bounded: a fixed sample per route for the percentiles, a fixed
 * ring of recent slow requests — a crawler hammering one URL cannot grow it.
 * It resets with the process (a deploy); the database side
 * (pg_stat_statements) keeps its numbers across restarts of the API.
 */
export const SLOW_REQUEST_MS = 1000;
const SAMPLE_PER_ROUTE = 300;
const SLOW_RING = 100;
const MAX_ROUTES = 400;

type RouteBucket = {
  count: number;
  totalMs: number;
  maxMs: number;
  errors: number;
  slow: number;
  /** Ring of the last SAMPLE_PER_ROUTE durations. */
  sample: number[];
  next: number;
};

export type RouteRow = {
  route: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  errors: number;
  slow: number;
  totalMs: number;
};

export type SlowRequest = {
  at: string;
  method: string;
  route: string;
  url: string;
  status: number;
  ms: number;
};

export class RequestStats {
  private routes = new Map<string, RouteBucket>();
  private slowRing: SlowRequest[] = [];
  /** Finish times (ms) of slow requests, for the alert window. */
  private slowTimes: number[] = [];
  readonly since = new Date();

  record(input: {
    method: string;
    route: string;
    url: string;
    status: number;
    ms: number;
    now?: number;
  }) {
    const key = `${input.method} ${input.route}`;
    let bucket = this.routes.get(key);
    if (!bucket) {
      if (this.routes.size >= MAX_ROUTES) return;
      bucket = {
        count: 0,
        totalMs: 0,
        maxMs: 0,
        errors: 0,
        slow: 0,
        sample: [],
        next: 0,
      };
      this.routes.set(key, bucket);
    }
    bucket.count++;
    bucket.totalMs += input.ms;
    bucket.maxMs = Math.max(bucket.maxMs, input.ms);
    if (input.status >= 500) bucket.errors++;
    if (bucket.sample.length < SAMPLE_PER_ROUTE) bucket.sample.push(input.ms);
    else {
      bucket.sample[bucket.next] = input.ms;
      bucket.next = (bucket.next + 1) % SAMPLE_PER_ROUTE;
    }
    if (input.ms >= SLOW_REQUEST_MS) {
      bucket.slow++;
      const now = input.now ?? Date.now();
      this.slowTimes.push(now);
      this.slowRing.unshift({
        at: new Date(now).toISOString(),
        method: input.method,
        route: input.route,
        url: input.url.slice(0, 300),
        status: input.status,
        ms: Math.round(input.ms),
      });
      if (this.slowRing.length > SLOW_RING) this.slowRing.length = SLOW_RING;
    }
  }

  /** Routes, heaviest (count × avg) first. */
  routesTable(): RouteRow[] {
    return [...this.routes.entries()]
      .map(([route, b]) => {
        const sorted = [...b.sample].sort((x, y) => x - y);
        return {
          route,
          count: b.count,
          avgMs: Math.round(b.totalMs / b.count),
          p50Ms: Math.round(percentile(sorted, 0.5)),
          p95Ms: Math.round(percentile(sorted, 0.95)),
          maxMs: Math.round(b.maxMs),
          errors: b.errors,
          slow: b.slow,
          totalMs: Math.round(b.totalMs),
        };
      })
      .sort((a, b) => b.totalMs - a.totalMs);
  }

  recentSlow(): SlowRequest[] {
    return this.slowRing;
  }

  /** Slow requests that finished within the last `windowMs`. */
  slowInWindow(windowMs: number, now = Date.now()): number {
    const from = now - windowMs;
    while (this.slowTimes.length && this.slowTimes[0] < from)
      this.slowTimes.shift();
    return this.slowTimes.length;
  }

  /** Slow requests of the window grouped by route, most first. */
  slowRoutesInWindow(windowMs: number, now = Date.now()) {
    const from = new Date(now - windowMs).toISOString();
    const counts = new Map<string, { count: number; maxMs: number }>();
    for (const row of this.slowRing) {
      if (row.at < from) break;
      const key = `${row.method} ${row.route}`;
      const entry = counts.get(key) ?? { count: 0, maxMs: 0 };
      entry.count++;
      entry.maxMs = Math.max(entry.maxMs, row.ms);
      counts.set(key, entry);
    }
    return [...counts.entries()]
      .map(([route, v]) => ({ route, ...v }))
      .sort((a, b) => b.count - a.count);
  }

  reset() {
    this.routes.clear();
    this.slowRing = [];
    this.slowTimes = [];
  }
}

export function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/**
 * The route a request matched, as a template (`/products/:slug`), so one
 * product page is one row and not ten thousand; unmatched paths are pooled.
 */
export function routeTemplate(req: {
  route?: { path?: unknown };
  baseUrl?: string;
}): string {
  const path = typeof req.route?.path === 'string' ? req.route.path : null;
  return path ? `${req.baseUrl ?? ''}${path}` : '(не найден маршрут)';
}
