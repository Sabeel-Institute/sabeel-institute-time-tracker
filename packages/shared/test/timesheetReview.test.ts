import { describe, expect, it } from 'vitest';
import {
  dayKeyFor,
  DEFAULT_REVIEW_LIMITS,
  entryMinutes,
  epochFor,
  periodKeyFor,
  recordedReviewFor,
  reviewFlagChange,
  reviewTimesheet,
  validReviewLimits,
  type TimeEntryDoc,
} from '../src';

const timeZone = 'America/Chicago';
const sunday = '2026-11-01';
const period = { fromKey: sunday, toKey: '2026-11-07' };

function entry(id: string, start: number, end: number | null, changes?: Partial<TimeEntryDoc>) {
  const dayKey = dayKeyFor(start, timeZone);
  return {
    id, uid: 'member', activityId: 'setup', activityName: 'Setup', source: 'clock' as const,
    dayKey, periodKey: periodKeyFor(dayKey), start, end, timeZone, createdAt: start, updatedAt: end ?? start,
    ...(end !== null ? { durationMinutes: entryMinutes(start, end) } : {}),
    ...changes,
  };
}

function work(id: string, day: string, time: string, minutes: number, changes?: Partial<TimeEntryDoc>) {
  const start = epochFor(day, time, timeZone);
  return entry(id, start, start + minutes * 60000, changes);
}

describe('timesheet duration review', () => {
  it('uses exclusive thresholds, includes manual and clock entries, and skips running sessions', () => {
    const end = epochFor(sunday, '20:00', timeZone);
    const entries = [
      work('one', sunday, '14:00', 1),
      work('two', sunday, '15:00', 2, { source: 'manual' }),
      work('three', sunday, '16:00', 3),
      work('eight', '2026-11-02', '08:00', 480),
      work('long', '2026-11-03', '08:00', 481),
      entry('running', end, null),
    ];
    const { flags } = reviewTimesheet(DEFAULT_REVIEW_LIMITS, entries, period);
    expect(flags.map((flag) => [flag.kind, 'entryId' in flag && flag.entryId])).toEqual([
      ['short', 'one'],
      ['short', 'two'],
      ['long', 'long'],
    ]);
  });

  it('keeps the 12-hour auto-close warning even when admins raise the maximum', () => {
    const limits = { minEntryMinutes: 1, maxEntryMinutes: 1440, maxDayMinutes: 1500 };
    const entries = [
      work('automatic', '2026-11-02', '07:00', 720, { autoClosed: true }),
      work('edited', '2026-11-03', '07:00', 300, { autoClosed: true }),
      work('clocked-out', '2026-11-04', '07:00', 720),
    ];
    expect(reviewTimesheet(limits, entries, period).flags)
      .toEqual([expect.objectContaining({ kind: 'autoClosed', entryId: 'automatic' })]);
  });

  it('splits hours across local midnight and counts the fall-back hour in the right day', () => {
    const limits = { ...DEFAULT_REVIEW_LIMITS, maxDayMinutes: 720 };
    const overnight = work('night', '2026-10-31', '23:00', 240);
    const day = work('day', sunday, '09:00', 541);
    const { flags } = reviewTimesheet(limits, [overnight, day], period);
    expect(flags).toContainEqual(expect.objectContaining({ kind: 'dayTotal', dayKey: sunday, minutes: 721 }));
    expect(flags).toContainEqual(expect.objectContaining({ kind: 'long', entryId: 'day' }));
    expect(flags).toHaveLength(2);
  });

  it('includes next-period hours on a day touched by this period and ignores unrelated days', () => {
    const limits = { ...DEFAULT_REVIEW_LIMITS, maxDayMinutes: 120 };
    const entries = [
      work('overnight', period.toKey, '23:30', 90),
      work('next morning', '2026-11-08', '10:00', 61),
      work('next week', '2026-11-09', '10:00', 121),
    ];
    expect(reviewTimesheet(limits, entries, period).flags)
      .toEqual([expect.objectContaining({ kind: 'dayTotal', dayKey: '2026-11-08', minutes: 121 })]);
  });

  it('does not flag a neighboring day when an overnight timer credits it zero minutes', () => {
    const start = epochFor(period.toKey, '23:59', timeZone) + 20_000;
    const timer = entry('overnight', start, start + 50_000);
    const neighbor = work('next period', '2026-11-08', '10:00', 120);
    const limits = { ...DEFAULT_REVIEW_LIMITS, maxDayMinutes: 60 };
    expect(reviewTimesheet(limits, [timer, neighbor], period).flags)
      .toEqual([expect.objectContaining({ kind: 'short', entryId: 'overnight', minutes: 1 })]);
  });

  it('identifies flags added by a config change and previously flagged entries edited after submission', () => {
    const initial = work('short', sunday, '14:00', 2);
    const normal = work('normal', sunday, '15:00', 60);
    const submitted = reviewTimesheet(DEFAULT_REVIEW_LIMITS, [initial, normal], period);
    const reviewed = reviewTimesheet({ ...DEFAULT_REVIEW_LIMITS, maxEntryMinutes: 30 }, [
      { ...initial, updatedAt: initial.updatedAt + 1 }, normal,
    ], period);
    expect(reviewed.flags.map((flag) => [flag.kind, reviewFlagChange(flag, submitted)]))
      .toEqual([['long', 'new'], ['short', 'edited']]);
    expect(reviewFlagChange(submitted.flags[0], submitted)).toBeUndefined();
  });

  it('ignores stale review snapshots and omits malformed flags from new snapshots', () => {
    const initial = work('short', sunday, '14:00', 2);
    const review = reviewTimesheet(DEFAULT_REVIEW_LIMITS, [initial], period);
    const saved = { ...review, flags: [...review.flags, null as never], at: 1 };
    expect(recordedReviewFor(saved, 2)).toBeUndefined();
    expect(recordedReviewFor(saved, 1)).toEqual({ ...review, at: 1 });
  });

  it('leaves an empty week valid even with odd or long entries in a neighboring week', () => {
    const neighbor = work('old', '2026-10-31', '23:00', 120, { timeZone: 'unrecognized' });
    const limits = { ...DEFAULT_REVIEW_LIMITS, minEntryMinutes: 120, maxDayMinutes: 1 };
    expect(reviewTimesheet(limits, [neighbor], period)).toEqual({ limits, flags: [] });
  });

  it('keeps legacy rows with bad zones and out-of-range spans from crashing a populated review', () => {
    const limits = { ...DEFAULT_REVIEW_LIMITS, maxDayMinutes: 120 };
    const neighbor = work('old', '2026-10-31', '23:00', 120, { timeZone: 'unrecognized' });
    const start = epochFor(sunday, '07:00', timeZone);
    const legacy = entry('long span', start, start + 100 * 86400000, { durationMinutes: 120 });
    const normal = work('normal', sunday, '13:00', 1);
    const { flags } = reviewTimesheet(limits, [neighbor, legacy, normal], period);
    expect(flags).toContainEqual(expect.objectContaining({ kind: 'dayTotal', dayKey: sunday, minutes: 121 }));
    expect(flags).toHaveLength(2);
  });

  it('detects changes to a flagged day with the same total, independent of entry order', () => {
    const limits = { ...DEFAULT_REVIEW_LIMITS, maxDayMinutes: 120 };
    const morning = work('morning', sunday, '09:00', 90);
    const afternoon = work('afternoon', sunday, '13:00', 45);
    const original = reviewTimesheet(limits, [morning, afternoon], period);
    const reordered = reviewTimesheet(limits, [afternoon, morning], period);
    const replacement = work('replacement', sunday, '14:00', 45);
    const revised = reviewTimesheet(limits, [morning, replacement], period);
    expect(reviewFlagChange(reordered.flags[0], original)).toBeUndefined();
    expect(reviewFlagChange(revised.flags[0], original)).toBe('edited');
  });

  it('validates whole minutes and ordered entry thresholds', () => {
    expect(validReviewLimits(DEFAULT_REVIEW_LIMITS)).toBe(true);
    expect(validReviewLimits({ ...DEFAULT_REVIEW_LIMITS, minEntryMinutes: 0 })).toBe(false);
    expect(validReviewLimits({ ...DEFAULT_REVIEW_LIMITS, minEntryMinutes: 0.5 })).toBe(false);
    expect(validReviewLimits({ ...DEFAULT_REVIEW_LIMITS, maxEntryMinutes: 2 })).toBe(false);
    expect(validReviewLimits({ ...DEFAULT_REVIEW_LIMITS, maxDayMinutes: 1501 })).toBe(false);
  });
});
