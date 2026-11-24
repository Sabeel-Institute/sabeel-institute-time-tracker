import { MAX_ENTRY_HOURS, SESSION_CAP_HOURS } from './constants';
import { addDays, dayKeyFor, entryMinutes, isDayKey } from './time';
import { overlappingEntryIds } from './overlap';
import type { TimeEntryDoc, TimesheetDoc } from './types';

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
  | { kind: 'dayTotal'; dayKey: string; minutes: number; entryVersions?: string[] };

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
    if (!flag || !isDayKey(flag.dayKey) || !Number.isInteger(flag.minutes) || flag.minutes < 1) return false;
    return (flag.kind === 'dayTotal' && (flag.entryVersions === undefined
      || (Array.isArray(flag.entryVersions) && flag.entryVersions.every((version) => typeof version === 'string')))) || (
      (flag.kind === 'short' || flag.kind === 'long' || flag.kind === 'autoClosed')
      && typeof flag.entryId === 'string' && Number.isInteger(flag.updatedAt)
    );
  });
  return { ...review, flags };
}

interface ReviewedTimesheet {
  periodKey: string;
  entriesVersion: string;
  reviewVersion: string;
}

export interface ApprovalRequest extends ReviewedTimesheet {
  uid: string;
  sheetVersion: string;
}

export interface SubmissionRequest extends ReviewedTimesheet {
  approverUid: string;
  /** null represents a draft with no timesheet document. */
  sheetVersion: string | null;
}

export const WEEK_CHANGED = "This week changed a moment ago, so that didn't go through. It now shows where it stands.";

export function timesheetRevision(sheet: TimesheetDoc): string {
  return JSON.stringify([sheet.status, sheet.createdAt, sheet.submittedAt, sheet.decidedAt, sheet.updatedAt]);
}

type ReviewPeriod = { fromKey: string; toKey: string };

/** Include overlapping entries even when the locations differ by up to 26 hours. */
export function reviewEntryRange(period: ReviewPeriod): ReviewPeriod {
  return { fromKey: addDays(period.fromKey, -3), toKey: addDays(period.toKey, 3) };
}

/** Stable values from an entry on screen, including note-only edits. */
export function timeEntryRevision(entry: ReviewEntry): string {
  return JSON.stringify([
    entry.id, entry.uid, entry.createdAt, entry.updatedAt, entry.start, entry.end, entry.dayKey,
    entry.periodKey, entry.durationMinutes, entry.timeZone, entry.activityId, entry.activityName,
    entry.source, entry.note, entry.autoClosed, entry.lastEditedBy,
  ]);
}

export function timesheetEntriesVersion(entries: ReviewEntry[]): string {
  return JSON.stringify(entries.map(timeEntryRevision).sort());
}

export function timesheetReviewVersion(review?: ReviewSnapshot): string {
  if (!review) return '[]';
  const { minEntryMinutes, maxEntryMinutes, maxDayMinutes } = review.limits;
  return JSON.stringify([minEntryMinutes, maxEntryMinutes, maxDayMinutes, review.flags]);
}

type ReviewEntry = TimeEntryDoc & { id: string };

export function timesheetReviewEntries(nearby: ReviewEntry[], period: ReviewPeriod, limits?: ReviewLimits) {
  const entries = nearby.filter((entry) => entry.dayKey >= period.fromKey && entry.dayKey <= period.toKey);
  const needsReview = entries.some((entry) => entry.end !== null);
  const overlaps = needsReview ? overlappingEntryIds(nearby) : new Set<string>();
  return {
    entries,
    needsReview,
    conflicts: new Set(entries.filter((entry) => overlaps.has(entry.id)).map((entry) => entry.id)),
    hasRunning: entries.some((entry) => entry.end === null),
    review: needsReview && limits ? reviewTimesheet(limits, nearby, period) : undefined,
  };
}

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

/** Allocate logged minutes across local midnight without rounding the parts
 * independently. Older/imported rows can have an unrecognized time zone or
 * a span outside the app's entry limit. Keep those hours on their recorded
 * work date and bound the amount of calendar work for a rollup.
 */
function minutesByLocalDay(start: number, end: number, minutes: number, entry: ReviewEntry): [string, number][] {
  const recordedDay: [string, number][] = [[entry.dayKey, minutes]];
  if (end - start > MAX_ENTRY_HOURS * 60 * MINUTE) return recordedDay;
  try {
    const parts: [string, number][] = [];
    const shareAt = (time: number) => Math.round(minutes * (time - start) / (end - start));
    for (let cursor = start; cursor < end;) {
      const day = dayKeyFor(cursor, entry.timeZone);
      const boundary = endOfLocalDay(cursor, end, day, entry.timeZone);
      parts.push([day, shareAt(boundary) - shareAt(cursor)]);
      cursor = boundary;
    }
    return parts;
  } catch (e) {
    if (e instanceof RangeError) return recordedDay;
    throw e;
  }
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
  const localDays = new Map<string, { minutes: number; entryVersions: string[] }>();
  const daysInReview = new Set<string>();
  const isInPeriod = (dayKey: string) => dayKey >= period.fromKey && dayKey <= period.toKey;
  if (!entries.some((entry) => entry.end !== null && isInPeriod(entry.dayKey))) return { limits, flags };

  for (const entry of entries) {
    const { start, end } = entry;
    if (end === null || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const inPeriod = isInPeriod(entry.dayKey);
    const minutes = entry.durationMinutes ?? entryMinutes(start, end);
    const updatedAt = Number.isInteger(entry.updatedAt) ? entry.updatedAt : start;
    if (inPeriod) {
      const details = { entryId: entry.id, dayKey: entry.dayKey, minutes, updatedAt };
      if (minutes < limits.minEntryMinutes) flags.push({ kind: 'short', ...details });
      if (minutes > limits.maxEntryMinutes) flags.push({ kind: 'long', ...details });
      if (entry.autoClosed && end - start === SESSION_CAP_HOURS * 60 * MINUTE) {
        flags.push({ kind: 'autoClosed', ...details });
      }
    }

    for (const [day, share] of minutesByLocalDay(start, end, minutes, entry)) {
      if (share <= 0) continue;
      const total = localDays.get(day) ?? { minutes: 0, entryVersions: [] };
      total.minutes += share;
      total.entryVersions.push(JSON.stringify([entry.id, start, end, updatedAt, share]));
      localDays.set(day, total);
      if (inPeriod) daysInReview.add(day);
    }
  }
  for (const dayKey of daysInReview) {
    const { minutes, entryVersions } = localDays.get(dayKey)!;
    if (minutes > limits.maxDayMinutes) {
      flags.push({ kind: 'dayTotal', dayKey, minutes, entryVersions: entryVersions.sort() });
    }
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
  if (flag.kind === 'dayTotal' && earlier.kind === 'dayTotal'
      && JSON.stringify(flag.entryVersions) !== JSON.stringify(earlier.entryVersions)) return 'edited';
  return undefined;
}
