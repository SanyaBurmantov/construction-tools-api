/**
 * Calendar arithmetic for the traffic report, in the shop's own time zone
 * (Minsk, UTC+3 all year — no DST since 2011). Pure, tested.
 *
 * Months are `YYYY-MM` keys, days `YYYY-MM-DD`; the database groups by the
 * same keys (`to_char(... AT TIME ZONE 'Europe/Minsk')`), so the report only
 * has to fill the gaps where nobody came.
 */
const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** The Minsk calendar date of an instant, as UTC fields of a shifted Date. */
function minsk(now: Date): Date {
  return new Date(now.getTime() + MINSK_OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function monthKey(year: number, month0: number): string {
  const d = new Date(Date.UTC(year, month0, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** The last `count` months, oldest first, ending with the current one. */
export function lastMonths(now: Date, count: number): string[] {
  const m = minsk(now);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(monthKey(m.getUTCFullYear(), m.getUTCMonth() - i));
  }
  return keys;
}

/** UTC instant of 00:00 Minsk on the first day of the month `offset` away. */
export function monthStart(now: Date, offset = 0): Date {
  const m = minsk(now);
  return new Date(
    Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + offset, 1) - MINSK_OFFSET_MS,
  );
}

/** Day of the month today in Minsk (1-based) and the month's length. */
export function dayOfMonth(now: Date): number {
  return minsk(now).getUTCDate();
}

export function daysInMonth(now: Date, offset = 0): number {
  const m = minsk(now);
  return new Date(
    Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + offset + 1, 0),
  ).getUTCDate();
}

/**
 * The same stretch of last month: from its first day up to the same day of
 * the month and the same time of day (clamped to that month's length). «This
 * month so far» against a whole previous month is always a fall in the first
 * weeks — this comparison is the honest one.
 */
export function previousMonthToDate(now: Date): { from: Date; to: Date } {
  const from = monthStart(now, -1);
  const elapsed = now.getTime() - monthStart(now, 0).getTime();
  const prevLength = monthStart(now, 0).getTime() - from.getTime();
  return { from, to: new Date(from.getTime() + Math.min(elapsed, prevLength)) };
}

/** Relative change, or null when there is nothing to compare with. */
export function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

/** The Minsk calendar date of an instant, `YYYY-MM-DD` (what Metrika takes). */
export function minskDate(instant: Date): string {
  const m = minsk(instant);
  return `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}-${pad(m.getUTCDate())}`;
}
