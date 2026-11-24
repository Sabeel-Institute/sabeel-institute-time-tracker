import { MAX_ENTRY_HOURS, SESSION_CAP_HOURS } from './constants';
import { dayKeyFor, entryMinutes } from './time';
import type { TimeEntryDoc } from './types';

const MINUTE = 60_000;

export const TIMESHEET_REVIEW_CONFIG_DOC = 'timesheetReview';

export interface ReviewLimits {
  minEntryMinutes: number;
  maxEntryMinutes: number;
  maxDayMinutes: number;
}

export const DEFAULT_REVIEW_LIMITS: Readonly<ReviewLimits> = {
  minEntryMinutes: 3,
  maxEntryMinutes: 8 * 60,
  maxDayMinutes: 12 * 60,
};

export function validReviewLimits(limits: ReviewLimits): boolean {
  const { minEntryMinutes, maxEntryMinutes, maxDayMinutes } = limits;
  return [minEntryMinutes, maxEntryMinutes, maxDayMinutes].every(Number.isInteger)
    && minEntryMinutes >= 1 && minEntryMinutes <= maxEntryMinutes
    && maxEntryMinutes <= MAX_ENTRY_HOURS * 60
    && maxDayMinutes >= 1 && maxDayMinutes <= 25 * 60;
}

export type ReviewFlag =
  | { kind: 'short' | 'long' | 'autoClosed'; entryId: string; dayKey: string; minutes: number; updatedAt: number }
  | { kind: 'dayTotal'; dayKey: string; minutes: number };

export interface ReviewSnapshot {
  limits: ReviewLimits;
  flags: ReviewFlag[];
}

export interface RecordedReview extends ReviewSnapshot {
  at: number;
}

/** Older clients can resubmit without updating the previous confirmation. */
export function recordedReviewFor(review?: RecordedReview, at?: number): RecordedReview | undefined {
  if (!review || !Number.isInteger(at) || review.at !== at || !review.limits
      || !validReviewLimits(review.limits) || !Array.isArray(review.flags)) return undefined;
  // The snapshot was written by a client. Ignore malformed flags on read.
  const flags = review.flags.filter((flag) => {
    if (!flag || !/^\d{4}-\d{2}-\d{2}$/.test(flag.dayKey) || !Number.isInteger(flag.minutes) || flag.minutes < 1) return false;
    return flag.kind === 'dayTotal' || (
      (flag.kind === 'short' || flag.kind === 'long' || flag.kind === 'autoClosed')
      && typeof flag.entryId === 'string' && Number.isInteger(flag.updatedAt)
    );
  });
  return { ...review, flags };
}

type ReviewEntry = TimeEntryDoc & { id: string };

/** Find the first instant on the following local day, including DST changes. */
function endOfLocalDay(start: number, end: number, dayKey: string, timeZone: string): number {
  if (dayKeyFor(end - 1, timeZone) === dayKey) return end;
  let sameDay = start;
  let laterDay = end - 1;
  while (laterDay - sameDay > 1) {
    const mid = sameDay + Math.floor((laterDay - sameDay) / 2);
    if (dayKeyFor(mid, timeZone) === dayKey) sameDay = mid;
    else laterDay = mid;
  }
  return laterDay;
}

/**
 * Flags for the reviewed period. Nearby entries contribute to a shared local
 * day's total, but only days containing some work from this sheet are flagged.
 */
export function reviewTimesheet(
  limits: ReviewLimits,
  entries: ReviewEntry[],
  period: { fromKey: string; toKey: string },
): ReviewSnapshot {
  const flags: ReviewFlag[] = [];
  const dayTotals = new Map<string, number>();
  const daysInReview = new Set<string>();
  for (const entry of entries) {
    const { start, end } = entry;
    if (end === null || end <= start) continue;
    const inPeriod = entry.dayKey >= period.fromKey && entry.dayKey <= period.toKey;
    const minutes = entry.durationMinutes ?? entryMinutes(start, end);
    if (inPeriod) {
      const updatedAt = Number.isInteger(entry.updatedAt) ? entry.updatedAt : start;
      const details = { entryId: entry.id, dayKey: entry.dayKey, minutes, updatedAt };
      if (minutes < limits.minEntryMinutes) flags.push({ kind: 'short', ...details });
      if (minutes > limits.maxEntryMinutes) flags.push({ kind: 'long', ...details });
      if (entry.autoClosed && end - start === SESSION_CAP_HOURS * 60 * MINUTE) {
        flags.push({ kind: 'autoClosed', ...details });
      }
    }

    // Allocate the logged minutes proportionally across midnight. Rounding the
    // accumulated share keeps the split additive, even for a one-minute timer.
    const shareAt = (time: number) => Math.round(minutes * (time - start) / (end - start));
    for (let cursor = start; cursor < end;) {
      const day = dayKeyFor(cursor, entry.timeZone);
      const boundary = endOfLocalDay(cursor, end, day, entry.timeZone);
      dayTotals.set(day, (dayTotals.get(day) ?? 0) + shareAt(boundary) - shareAt(cursor));
      if (inPeriod) daysInReview.add(day);
      cursor = boundary;
    }
  }
  for (const dayKey of daysInReview) {
    const minutes = dayTotals.get(dayKey)!;
    if (minutes > limits.maxDayMinutes) flags.push({ kind: 'dayTotal', dayKey, minutes });
  }
  flags.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || reviewFlagKey(a).localeCompare(reviewFlagKey(b)));
  return { limits, flags };
}

export function reviewFlagKey(flag: ReviewFlag): string {
  return 'entryId' in flag ? `${flag.kind}:${flag.entryId}` : `dayTotal:${flag.dayKey}`;
}

/** Entry edits invalidate the earlier confirmation even when the duration is unchanged. */
export function reviewFlagChange(flag: ReviewFlag, submitted?: ReviewSnapshot): 'new' | 'edited' | undefined {
  if (!submitted) return undefined;
  const earlier = submitted.flags.find((item) => reviewFlagKey(item) === reviewFlagKey(flag));
  if (!earlier) return 'new';
  if (earlier.minutes !== flag.minutes || earlier.dayKey !== flag.dayKey) return 'edited';
  if ('updatedAt' in flag && 'updatedAt' in earlier && flag.updatedAt !== earlier.updatedAt) return 'edited';
  return undefined;
}
