import { describe, it, expect } from 'vitest';
import {
  addDays,
  dayLabel,
  monthRange,
  periodHasStarted,
  periodKeyFor,
  periodLabel,
  periodRangeFor,
  periodsOfMonth,
  sundayIndex,
} from '../src/time';

// Timesheet periods: Sunday–Saturday weeks clipped to month boundaries.
// 2026 months conveniently start on all seven weekdays:
//   Feb=Sun, Jun=Mon, Sep=Tue, Jul=Wed, Jan/Oct=Thu, May=Fri, Aug=Sat.

describe('sundayIndex', () => {
  it('pins known dates', () => {
    expect(sundayIndex('2026-07-12')).toBe(0); // Sunday
    expect(sundayIndex('2026-07-15')).toBe(3); // Wednesday
    expect(sundayIndex('2026-07-04')).toBe(6); // Saturday
    expect(sundayIndex('1970-01-01')).toBe(4); // epoch day 0 = Thursday
  });
});

describe('periodKeyFor / periodRangeFor', () => {
  it('mid-month full week', () => {
    expect(periodKeyFor('2026-07-15')).toBe('2026-07-12');
    expect(periodRangeFor('2026-07-15')).toEqual({ fromKey: '2026-07-12', toKey: '2026-07-18' });
  });

  it('clips the first period of a mid-week-starting month (Jul 2026 starts Wed)', () => {
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']) {
      expect(periodKeyFor(d)).toBe('2026-07-01');
      expect(periodRangeFor(d)).toEqual({ fromKey: '2026-07-01', toKey: '2026-07-04' });
    }
    expect(periodKeyFor('2026-07-05')).toBe('2026-07-05'); // next period starts Sunday
  });

  it('clips the last period of a month (Jul 2026 ends Fri 31st)', () => {
    expect(periodRangeFor('2026-07-31')).toEqual({ fromKey: '2026-07-26', toKey: '2026-07-31' });
  });

  it('single-day period when the 31st is a Sunday (May 2026)', () => {
    expect(periodRangeFor('2026-05-31')).toEqual({ fromKey: '2026-05-31', toKey: '2026-05-31' });
  });

  it('month starting on Sunday needs no first-period clipping (Feb 2026)', () => {
    expect(periodRangeFor('2026-02-01')).toEqual({ fromKey: '2026-02-01', toKey: '2026-02-07' });
    expect(periodRangeFor('2026-02-28')).toEqual({ fromKey: '2026-02-22', toKey: '2026-02-28' });
  });

  it('leap February (2024-02-29 belongs to the 02-25 period)', () => {
    expect(periodRangeFor('2024-02-29')).toEqual({ fromKey: '2024-02-25', toKey: '2024-02-29' });
  });

  it('never crosses a month boundary (year boundary too)', () => {
    // 2026-01-01 is a Thursday; its period is clipped to Jan 1–3.
    expect(periodRangeFor('2026-01-01')).toEqual({ fromKey: '2026-01-01', toKey: '2026-01-03' });
    // 2025-12-31 (Wed) sits in December's final clipped period.
    expect(periodRangeFor('2025-12-31')).toEqual({ fromKey: '2025-12-28', toKey: '2025-12-31' });
  });
});

describe('periodsOfMonth', () => {
  it('July 2026 (starts Wed, 31 days) has 6 periods with clipped ends', () => {
    expect(periodsOfMonth('2026-07-15')).toEqual([
      { fromKey: '2026-07-01', toKey: '2026-07-04' },
      { fromKey: '2026-07-05', toKey: '2026-07-11' },
      { fromKey: '2026-07-12', toKey: '2026-07-18' },
      { fromKey: '2026-07-19', toKey: '2026-07-25' },
      { fromKey: '2026-07-26', toKey: '2026-07-31' },
    ]);
  });

  it('Feb 2026 (starts Sunday, 28 days) is exactly 4 full periods', () => {
    const periods = periodsOfMonth('2026-02-10');
    expect(periods).toHaveLength(4);
    for (const p of periods) expect(addDays(p.fromKey, 6)).toBe(p.toKey);
  });

  it('property: 2024–2027, every month tiles perfectly and keys are canonical', () => {
    for (let y = 2024; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        const anchor = `${y}-${String(m).padStart(2, '0')}-15`;
        const { fromKey, toKey } = monthRange(anchor);
        const periods = periodsOfMonth(anchor);

        // Tiling: starts at month start, ends at month end, no gaps/overlaps.
        expect(periods[0].fromKey).toBe(fromKey);
        expect(periods[periods.length - 1].toKey).toBe(toKey);
        for (let i = 1; i < periods.length; i++) {
          expect(periods[i].fromKey).toBe(addDays(periods[i - 1].toKey, 1));
        }

        for (const p of periods) {
          // fromKey is a Sunday or the 1st; toKey a Saturday or the month end.
          expect(sundayIndex(p.fromKey) === 0 || p.fromKey === fromKey).toBe(true);
          expect(sundayIndex(p.toKey) === 6 || p.toKey === toKey).toBe(true);
          expect(p.fromKey <= p.toKey).toBe(true);
          // Every day of the period maps back to this period.
          for (let d = p.fromKey; d <= p.toKey; d = addDays(d, 1)) {
            expect(periodKeyFor(d)).toBe(p.fromKey);
            expect(periodRangeFor(d)).toEqual(p);
          }
        }
      }
    }
  });
});

describe('periodHasStarted', () => {
  it('past and current periods have started; future have not', () => {
    expect(periodHasStarted('2026-07-12', '2026-07-15')).toBe(true);
    expect(periodHasStarted('2026-07-12', '2026-07-12')).toBe(true);
    expect(periodHasStarted('2026-07-19', '2026-07-15')).toBe(false);
  });
});

describe('periodLabel', () => {
  it('formats compact ranges', () => {
    expect(periodLabel({ fromKey: '2026-07-05', toKey: '2026-07-11' })).toBe('Jul 5 – Jul 11');
    expect(periodLabel({ fromKey: '2026-05-31', toKey: '2026-05-31' })).toBe('May 31 – May 31');
  });
});

describe('dayLabel', () => {
  it('names the weekday and the date', () => {
    expect(dayLabel('2026-11-01')).toBe('Sunday, Nov 1');
    expect(dayLabel('2026-07-15', 2026)).toBe('Wednesday, Jul 15');
  });
  it('adds the year only when it is not the current one', () => {
    expect(dayLabel('2025-12-31', 2026)).toBe('Wednesday, Dec 31, 2025');
  });
});
