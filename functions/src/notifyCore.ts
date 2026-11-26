// Pure notification logic — no Firebase imports, unit-testable.
import {
  addDays,
  periodKeyFor,
  periodLabel,
  periodRangeFor,
  type NotifPrefs,
  type NotifRoute,
  type TimesheetDoc,
  type TimesheetStatus,
} from '@sabeel/shared';

/** Missing key = ON: nobody has to configure anything to get notified. */
export function prefOn(prefs: NotifPrefs | undefined, key: keyof NotifPrefs): boolean {
  return prefs?.[key] !== false;
}

/** Local weekday (0=Sun) and hour-of-day for an instant in an IANA timezone. */
export function localClock(nowMs: number, timeZone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = names.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
  // `% 24` guards the h24-vs-h23 hourCycle quirk: some ICU builds render local
  // midnight as "24" under hour12:false, which would put the reminder window an
  // hour off for anyone whose 10:00 check straddles it. This Node's ICU returns
  // "00", so the modulo is a no-op HERE and cannot be tested on this runtime — a
  // test pinning midnight would pass with or without it. Keep it: functions run
  // on a different ICU than this machine. Do not "simplify" it away, and do not
  // add a test that only looks like it covers it.
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '-1') % 24;
  return { weekday, hour };
}

/**
 * The reminder window: 10:00–10:59 local, Tuesday through Saturday. The first
 * nudge about last week lands on Tuesday (Sunday/Monday are grace days), then
 * it repeats DAILY until the week is submitted. Sunday rolls "last week"
 * forward, so a still-unsubmitted week simply starts nagging again the next
 * Tuesday. Daily dedup is the caller's job (lastReminderDayKey).
 */
export function inReminderWindow(nowMs: number, timeZone: string): boolean {
  const { weekday, hour } = localClock(nowMs, timeZone);
  return weekday >= 2 && weekday <= 6 && hour === 10;
}

/** The period the reminder is about: the one before the user's current period. */
export function reminderPeriod(todayKey: string): { fromKey: string; toKey: string } {
  return periodRangeFor(addDays(periodKeyFor(todayKey), -1));
}

/**
 * Whether last week actually needs a nudge. Submitted/approved sheets are done;
 * a rejected sheet needs resubmission; no sheet only matters when hours were
 * logged (an empty untouched week is not worth nagging about).
 */
export function reminderEligible(
  sheetStatus: TimesheetStatus | null,
  hasEntries: boolean,
): boolean {
  if (sheetStatus === 'submitted' || sheetStatus === 'approved') return false;
  if (sheetStatus === 'rejected') return true;
  return hasEntries;
}

/**
 * A push is text plus a destination — the two are decided together, because a
 * notification that says "your timesheet was rejected" and then drops you on the
 * home screen has done half its job.
 */
export interface Notif {
  title: string;
  body: string;
  route: NotifRoute;
}

type Range = { fromKey: string; toKey: string };

/**
 * What a timesheet write tells its approver: a submission or a resubmission.
 * A week passed on while waiting is told by handOverTimesheets, once per
 * hand-over rather than once per week. Nothing for their own week: a manager
 * or admin approving their own hours needs no push about it.
 */
export function approverNotice(
  before: TimesheetDoc | null,
  after: TimesheetDoc,
): 'submitted' | 'resubmitted' | null {
  if (after.status !== 'submitted' || after.approverUid === after.uid || before?.status === 'submitted') return null;
  return before?.status === 'rejected' ? 'resubmitted' : 'submitted';
}

export const texts = {
  newUser: (name: string, email: string): Notif => ({
    title: 'New account request',
    body: `${name} (${email}) is waiting for approval.`,
    route: { screen: 'Users' },
  }),
  submitted: (uid: string, name: string, range: Range, resubmit: boolean): Notif => ({
    title: resubmit ? 'Timesheet resubmitted' : 'Timesheet submitted',
    body: `${name} · ${periodLabel(range)}`,
    route: { screen: 'TimesheetReview', uid, displayName: name, periodKey: range.fromKey },
  }),
  /** `range` is the oldest of the `count` weeks; the tap opens it. */
  handedOver: (uid: string, name: string, range: Range, count: number): Notif => ({
    title: count === 1 ? 'Timesheet passed to you' : `${count} timesheets passed to you`,
    body: count === 1 ? `${name} · ${periodLabel(range)}` : `${name} · from ${periodLabel(range)}`,
    route: { screen: 'TimesheetReview', uid, displayName: name, periodKey: range.fromKey },
  }),
  /** `own`: the weeks were with the person themself, who may no longer approve. */
  needsApprover: (range: Range, count: number, own: boolean): Notif => ({
    title: 'Choose a new approver',
    body: `${own ? 'You can no longer approve timesheets yourself.' : 'Your approver can no longer approve timesheets.'} `
      + `Choose ${own ? 'an approver' : 'a new one'}, and your ${count === 1 ? 'waiting week goes' : `${count} waiting weeks go`} to them.`,
    route: { screen: 'Timesheet', periodKey: range.fromKey },
  }),
  approved: (range: Range): Notif => ({
    title: 'Timesheet approved',
    body: `Your timesheet for ${periodLabel(range)} was approved.`,
    route: { screen: 'Timesheet', periodKey: range.fromKey },
  }),
  rejected: (range: Range, reason: string): Notif => ({
    title: 'Timesheet rejected',
    body: `${periodLabel(range)}: ${reason}`,
    route: { screen: 'Timesheet', periodKey: range.fromKey },
  }),
  reminder: (range: Range): Notif => ({
    title: 'Timesheet reminder',
    body: `Last week (${periodLabel(range)}) hasn't been submitted yet.`,
    route: { screen: 'Timesheet', periodKey: range.fromKey },
  }),
};
