// Timesheet lifecycle writes + live hooks. Firestore rules authorize the
// legacy transitions. Current clients submit and approve through callables to
// check the reviewed rows at commit time. Reject, withdraw, and reopen check
// the displayed timesheet revision before writing.
import {
  collection,
  doc,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  patchApplied,
  timesheetEntriesVersion,
  timesheetReviewVersion,
  timesheetRevision,
  WEEK_CHANGED,
  type ApprovalRequest,
  type ReviewSnapshot,
  type SubmissionRequest,
  type TimesheetDoc,
} from '@sabeel/shared';
import { db, functions } from './firebase';
import { useLiveDoc, useLiveQuery } from './liveQuery';
import type { TimeEntry } from './entries';

export type Timesheet = TimesheetDoc & { id: string };

const tsId = (uid: string, periodKey: string) => `${uid}_${periodKey}`;

/** Explain a stale or refused week action while the live screen catches up. */
export function weekWriteError(e: unknown): unknown {
  return e instanceof FirebaseError && e.code === 'permission-denied' ? new Error(WEEK_CHANGED) : e;
}

export const WEEK_NOT_REACHED = "That didn't reach the server. Check your connection and try again; the week shows where it stands.";

/**
 * What to tell someone whose week action failed. A callable that never got an
 * answer (offline, a timeout, a server that gave up) reports a bare code such
 * as "internal"; say it in words. A timeout may still have landed, which is
 * why the message points at the week, which is live.
 */
export function weekActionMessage(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded' || code === 'functions/internal'
      || code === 'unavailable') {
    return WEEK_NOT_REACHED;
  }
  return e instanceof Error ? e.message : String(e);
}

async function weekWrite(write: Promise<void>): Promise<void> {
  try {
    await write;
  } catch (e) {
    throw weekWriteError(e);
  }
}

/** Bind the action to the revision the person saw. A withdrawn and
 * resubmitted sheet has the same id and status as the original.
 */
function changeTimesheet(ts: Timesheet, changes?: Record<string, unknown>): Promise<void> {
  const ref = doc(db, COLLECTIONS.timesheets, ts.id);
  return weekWrite(runTransaction(db, async (tx) => {
    const current = (await tx.get(ref)).data() as TimesheetDoc | undefined;
    // A retry after a lost commit response finds this write already applied:
    // the decision's own timestamp, or the sheet gone for a withdraw or reopen.
    if (changes ? patchApplied(current, changes) : !current) return;
    if (!current || timesheetRevision(current) !== timesheetRevision(ts)) throw new Error(WEEK_CHANGED);
    if (changes) tx.update(ref, changes);
    else tx.delete(ref);
  }));
}

/** Submit a reviewed draft or resubmit a rejected revision. Empty weeks are valid. */
export async function submitTimesheet(
  periodKey: string,
  approverUid: string,
  entries: TimeEntry[],
  review?: ReviewSnapshot,
  rejected?: Timesheet,
): Promise<void> {
  await httpsCallable<SubmissionRequest, object>(functions, 'submitReviewedTimesheet')({
    periodKey,
    approverUid,
    sheetVersion: rejected ? timesheetRevision(rejected) : null,
    entriesVersion: timesheetEntriesVersion(entries),
    reviewVersion: timesheetReviewVersion(review),
  });
}

/** Withdraw a not-yet-approved submission — the period returns to draft. */
export function withdrawTimesheet(ts: Timesheet): Promise<void> {
  return changeTimesheet(ts);
}

/** The server compares this exact review to the hours it seals. */
export async function approveTimesheet(
  ts: Timesheet,
  entries: TimeEntry[],
  review?: ReviewSnapshot,
): Promise<void> {
  await httpsCallable<ApprovalRequest, object>(functions, 'approveReviewedTimesheet')({
    uid: ts.uid,
    periodKey: ts.periodKey,
    sheetVersion: timesheetRevision(ts),
    entriesVersion: timesheetEntriesVersion(entries),
    reviewVersion: timesheetReviewVersion(review),
  });
}

/** Reject with a required reason — the sheet goes back to the owner. */
export async function rejectTimesheet(
  ts: Timesheet,
  deciderUid: string,
  reason: string,
): Promise<void> {
  const now = Date.now();
  await changeTimesheet(ts, {
    status: 'rejected',
    decidedAt: now,
    decidedBy: deciderUid,
    rejectReason: reason,
    updatedAt: now,
  });
}

/** Admin only: reopen any sheet (approved included) back to draft. */
export function reopenTimesheet(ts: Timesheet): Promise<void> {
  return changeTimesheet(ts);
}

/**
 * Live view of one (user, period) timesheet.
 * undefined = still loading; null = no doc (the period is a draft).
 */
export function useTimesheet(uid: string, periodKey: string): Timesheet | null | undefined {
  return useLiveDoc<Timesheet | null | undefined>(
    () => doc(db, COLLECTIONS.timesheets, tsId(uid, periodKey)),
    [uid, periodKey],
    {
      label: 'useTimesheet',
      map: (snap) => (snap.exists() ? { id: snap.id, ...(snap.data() as TimesheetDoc) } : null),
      empty: undefined,
    },
  );
}

/** Live list of a user's timesheets whose periodKey falls in an inclusive range. */
export function useMyTimesheetsRange(
  uid: string,
  fromKey: string,
  toKey: string,
): Timesheet[] {
  return useLiveQuery(
    () =>
      query(
        collection(db, COLLECTIONS.timesheets),
        where('uid', '==', uid),
        where('periodKey', '>=', fromKey),
        where('periodKey', '<=', toKey),
      ),
    [uid, fromKey, toKey],
    {
      label: 'useMyTimesheetsRange',
      map: (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as TimesheetDoc) }));
        list.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
        return list;
      },
      empty: [],
    },
  );
}

/**
 * Live approval queue: sheets submitted to me — or every submitted sheet when
 * `all` (admin view). Oldest submissions first. `enabled: false` subscribes to
 * nothing: a member has no queue, and the shell asks for every account.
 * undefined = still loading, failed, or not subscribed.
 */
export function useApprovalQueue(
  approverUid: string,
  opts?: { all?: boolean; enabled?: boolean },
): Timesheet[] | undefined {
  const all = opts?.all ?? false;
  const enabled = opts?.enabled ?? true;
  return useLiveQuery<Timesheet[] | undefined>(
    () => {
      if (!enabled) return null;
      const base = collection(db, COLLECTIONS.timesheets);
      return all
        ? query(base, where('status', '==', 'submitted'))
        : query(base, where('approverUid', '==', approverUid), where('status', '==', 'submitted'));
    },
    [approverUid, all, enabled],
    {
      label: 'useApprovalQueue',
      map: (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as TimesheetDoc) }));
        list.sort((a, b) => a.submittedAt - b.submittedAt);
        return list;
      },
      empty: undefined,
    },
  );
}

/** Live list of my timesheets in one state, oldest week first. */
function useMySheets(uid: string, status: 'submitted' | 'rejected', label: string): Timesheet[] | undefined {
  return useLiveQuery<Timesheet[] | undefined>(
    () =>
      query(
        collection(db, COLLECTIONS.timesheets),
        where('uid', '==', uid),
        where('status', '==', status),
      ),
    [uid, status],
    {
      label,
      map: (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as TimesheetDoc) }));
        list.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
        return list;
      },
      empty: undefined,
    },
  );
}

/**
 * Live list of my rejected timesheets, oldest first (the resolution backlog).
 * undefined = still loading (or the listen failed, which the banner says).
 */
export function useRejectedSheets(uid: string): Timesheet[] | undefined {
  return useMySheets(uid, 'rejected', 'useRejectedSheets');
}

/** Live list of my weeks waiting for approval, oldest first. undefined = loading. */
export function useWaitingSheets(uid: string): Timesheet[] | undefined {
  return useMySheets(uid, 'submitted', 'useWaitingSheets');
}
