import {
  change,
  dayOfMonth,
  daysInMonth,
  lastMonths,
  minskDate,
  monthStart,
  previousMonthToDate,
} from './traffic-periods';

describe('traffic periods (Minsk time)', () => {
  // 2026-11-05 10:00 Minsk.
  const now = new Date('2026-11-05T07:00:00Z');

  it('lists the last months oldest first, across a year boundary', () => {
    expect(lastMonths(now, 12)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
  });

  it('starts a month at midnight in Minsk', () => {
    expect(monthStart(now).toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(monthStart(now, -1).toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  it('uses the Minsk date late in the evening UTC', () => {
    // 2026-10-31 22:30 UTC is already 1 November in Minsk.
    const lateUtc = new Date('2026-10-31T22:30:00Z');
    expect(dayOfMonth(lateUtc)).toBe(1);
    expect(lastMonths(lateUtc, 1)).toEqual(['2026-11']);
  });

  it('compares with the same stretch of last month', () => {
    const { from, to } = previousMonthToDate(now);
    expect(from.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-05T07:00:00.000Z');
  });

  it('clamps the stretch to a shorter previous month', () => {
    // 31 March 12:00 Minsk → February has 28 days: the whole of February.
    const march31 = new Date('2026-03-31T09:00:00Z');
    const { to } = previousMonthToDate(march31);
    expect(to.toISOString()).toBe('2026-02-28T21:00:00.000Z');
    expect(daysInMonth(march31, -1)).toBe(28);
  });

  it('reports a relative change only against something', () => {
    expect(change(150, 100)).toBeCloseTo(0.5);
    expect(change(5, 0)).toBeNull();
  });
});

describe('minskDate', () => {
  it('formats the Minsk calendar date', () => {
    expect(minskDate(new Date('2026-10-31T22:30:00Z'))).toBe('2026-11-01');
    expect(minskDate(new Date('2026-11-05T07:00:00Z'))).toBe('2026-11-05');
  });
});
