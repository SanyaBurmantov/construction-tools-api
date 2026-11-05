/**
 * Yandex Metrika Reporting API answers → the shapes `/admin/traffic` already
 * draws (the same `TrafficMonth`, days and tables as our own counter). Pure,
 * tested against the documented response format, so the HTTP side stays
 * thin.
 *
 * `/stat/v1/data` answers `{ data: [{ dimensions: [{id, name}], metrics: [n…] }],
 * totals: [n…] }`; `/stat/v1/data/bytime` answers per-interval arrays:
 * `{ data: [{ dimensions, metrics: [[n per interval]…] }], time_intervals:
 * [[from, to]…], totals: [[n per interval]…] }`. Totals are computed over the
 * whole selection by Metrika, so unique users there are not double counted
 * across device rows.
 */
export type MetrikaDimension = { id?: string | null; name?: string | null };

export type MetrikaDataResponse = {
  data?: Array<{ dimensions?: MetrikaDimension[]; metrics?: number[] }>;
  totals?: number[];
};

export type MetrikaBytimeResponse = {
  data?: Array<{ dimensions?: MetrikaDimension[]; metrics?: number[][] }>;
  time_intervals?: Array<[string, string]>;
  totals?: number[][];
};

export type Device = 'mobile' | 'desktop' | 'tablet';

/** Metrika's `ym:s:deviceCategory` ids; a TV counts with computers. */
export function metrikaDevice(id?: string | null): Device {
  if (id === 'mobile' || id === 'smartphone') return 'mobile';
  if (id === 'tablet') return 'tablet';
  return 'desktop';
}

const n = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;

/** Visits/users/views over a period, split by device (metrics in that order). */
export function periodTotals(res: MetrikaDataResponse) {
  const devices: Record<Device, number> = { mobile: 0, desktop: 0, tablet: 0 };
  for (const row of res.data ?? []) {
    devices[metrikaDevice(row.dimensions?.[0]?.id)] += n(row.metrics?.[0]);
  }
  return {
    visits: n(res.totals?.[0]),
    visitors: n(res.totals?.[1]),
    views: n(res.totals?.[2]),
    devices,
  };
}

/** `2026-11-01` → `2026-11`. */
const monthOf = (date: string) => date.slice(0, 7);

/**
 * Monthly visits/users/views by device (bytime, group=month) plus monthly 404
 * views, onto the month keys the screen expects (missing months stay zero).
 */
export function monthsFromBytime(
  months: string[],
  byDevice: MetrikaBytimeResponse,
  notFound?: MetrikaBytimeResponse,
) {
  const index = new Map(months.map((m, i) => [m, i]));
  const rows = months.map((month) => ({
    month,
    visits: 0,
    visitors: 0,
    views: 0,
    notFound: 0,
    devices: { mobile: 0, desktop: 0, tablet: 0 } as Record<Device, number>,
  }));
  const intervals = byDevice.time_intervals ?? [];
  intervals.forEach(([from], t) => {
    const i = index.get(monthOf(from));
    if (i === undefined) return;
    rows[i].visits = n(byDevice.totals?.[0]?.[t]);
    rows[i].visitors = n(byDevice.totals?.[1]?.[t]);
    rows[i].views = n(byDevice.totals?.[2]?.[t]);
    for (const row of byDevice.data ?? []) {
      rows[i].devices[metrikaDevice(row.dimensions?.[0]?.id)] += n(
        row.metrics?.[0]?.[t],
      );
    }
  });
  (notFound?.time_intervals ?? []).forEach(([from], t) => {
    const i = index.get(monthOf(from));
    if (i !== undefined) rows[i].notFound = n(notFound?.totals?.[0]?.[t]);
  });
  return rows;
}

/** Daily visits (bytime, group=day) as `YYYY-MM-DD → visits`. */
export function visitsByDay(res: MetrikaBytimeResponse): Map<string, number> {
  const map = new Map<string, number>();
  (res.time_intervals ?? []).forEach(([from], t) => {
    map.set(from.slice(0, 10), n(res.totals?.[0]?.[t]));
  });
  return map;
}

/** Path of a full URL Metrika stores; the input itself when it is not one. */
export function pathOf(url?: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

/**
 * 404 views by (URL, referer) → one row per path: total views and the
 * referer that sent most of them.
 */
export function notFoundRows(res: MetrikaDataResponse) {
  const byPath = new Map<
    string,
    { path: string; views: number; referrers: Map<string, number> }
  >();
  for (const row of res.data ?? []) {
    const path = pathOf(row.dimensions?.[0]?.name ?? row.dimensions?.[0]?.id);
    if (!path) continue;
    const referrer = row.dimensions?.[1]?.name ?? row.dimensions?.[1]?.id ?? '';
    const views = n(row.metrics?.[0]);
    const entry = byPath.get(path) ?? { path, views: 0, referrers: new Map() };
    entry.views += views;
    if (referrer)
      entry.referrers.set(
        referrer,
        (entry.referrers.get(referrer) ?? 0) + views,
      );
    byPath.set(path, entry);
  }
  return [...byPath.values()]
    .map((entry) => ({
      path: entry.path,
      views: entry.views,
      visitors: 0,
      referrer:
        [...entry.referrers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
        null,
      lastAt: null as string | null,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 100);
}

/** Rows of one or two name dimensions and one metric → `{ label, value }`. */
export function labelledRows(res: MetrikaDataResponse, limit = 15) {
  const rows = new Map<string, number>();
  for (const row of res.data ?? []) {
    const names = (row.dimensions ?? [])
      .map((d) => d?.name ?? d?.id)
      .filter((v): v is string => Boolean(v));
    const label = [...new Set(names)].join(' · ') || 'не определено';
    rows.set(label, (rows.get(label) ?? 0) + n(row.metrics?.[0]));
  }
  return [...rows.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** Pageviews by full URL → by path. */
export function pathRows(res: MetrikaDataResponse, limit = 15) {
  const rows = new Map<string, number>();
  for (const row of res.data ?? []) {
    const path = pathOf(row.dimensions?.[0]?.name ?? row.dimensions?.[0]?.id);
    if (path) rows.set(path, (rows.get(path) ?? 0) + n(row.metrics?.[0]));
  }
  return [...rows.entries()]
    .map(([path, value]) => ({ path, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}
