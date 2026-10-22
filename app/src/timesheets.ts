// Timesheet lifecycle writes + live hooks. All transitions are plain client
// writes validated by firestore.rules (see /timesheets there): submit = create,
// decide = update by the stamped approver/admin, resubmit = update after
// rejection, withdraw/reopen = delete. totalMinutes/entryCount are informational
// snapshots — the live truth is always the period's entries.
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { COLLECTIONS, type TimesheetDoc } from '@sabeel/shared';
import { db } from './firebase';
import { useLiveDoc, useLiveQuery } from './liveQuery';
import type { TimeEntry } from './entries';

export type Timesheet = TimesheetDoc & { id: string };

const tsId = (uid: string, periodKey: string) => `${uid}_${periodKey}`;

/** Snapshot totals over a period's entries (closed only — a running one has no duration). */
function snapshotOf(entries: TimeEntry[]): { totalMinutes: number; entryCount: number } {
  const closed = entries.filter((e) => e.end !== null);
  return {
    totalMinutes: closed.reduce((s, e) => s + (e.durationMinutes ?? 0), 0),
    entryCount: closed.length,
  };
}

/** Submit the period (draft → submitted). Zero-hour submissions are fine. */
export async function submitTimesheet(
  uid: string,
  period: { fromKey: string; toKey: string },
  approverUid: string,
  entries: TimeEntry[],
): Promise<void> {
  const now = Date.now();
  const sheet: TimesheetDoc = {
    uid,
    periodKey: period.fromKey,
    toKey: period.toKey,
    status: 'submitted',
    approverUid,
    submittedAt: now,
    ...snapshotOf(entries),
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, COLLECTIONS.timesheets, tsId(uid, period.fromKey)), sheet);
}

/** Resubmit after rejection — re-stamps the approver, clears the decision. */
export async function resubmitTimesheet(
  ts: Timesheet,
  approverUid: string,
  entries: TimeEntry[],
): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(db, COLLECTIONS.timesheets, ts.id), {
    status: 'submitted',
    approverUid,
    submittedAt: now,
    ...snapshotOf(entries),
    updatedAt: now,
    decidedAt: deleteField(),
    decidedBy: deleteField(),
    rejectReason: deleteField(),
  });
}

/** Withdraw a not-yet-approved submission — the period returns to draft. */
export function withdrawTimesheet(ts: Timesheet): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.timesheets, ts.id));
}

/** Approve (stamped approver or admin). Refreshes the snapshot to what was reviewed. */
export async function approveTimesheet(
  ts: Timesheet,
  deciderUid: string,
  entries: TimeEntry[],
): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(db, COLLECTIONS.timesheets, ts.id), {
    status: 'approved',
    decidedAt: now,
    decidedBy: deciderUid,
    ...snapshotOf(entries),
    updatedAt: now,
  });
}

/** Reject with a required reason — the sheet goes back to the owner. */
export async function rejectTimesheet(
  ts: Timesheet,
  deciderUid: string,
  reason: string,
): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(db, COLLECTIONS.timesheets, ts.id), {
    status: 'rejected',
    decidedAt: now,
    decidedBy: deciderUid,
    rejectReason: reason,
    updatedAt: now,
  });
}

/** Admin only: reopen any sheet (approved included) back to draft. */
export function reopenTimesheet(ts: Timesheet): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.timesheets, ts.id));
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
 * `all` (admin view). Oldest submissions first.
 */
export function useApprovalQueue(approverUid: string, opts?: { all?: boolean }): Timesheet[] {
  const all = opts?.all ?? false;
  return useLiveQuery(
    () => {
      const base = collection(db, COLLECTIONS.timesheets);
      return all
        ? query(base, where('status', '==', 'submitted'))
        : query(base, where('approverUid', '==', approverUid), where('status', '==', 'submitted'));
    },
    [approverUid, all],
    {
      label: 'useApprovalQueue',
      map: (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as TimesheetDoc) }));
        list.sort((a, b) => a.submittedAt - b.submittedAt);
        return list;
      },
      empty: [],
    },
  );
}

/** Live list of my rejected timesheets, oldest first (the resolution backlog). */
export function useRejectedSheets(uid: string): Timesheet[] {
  return useLiveQuery(
    () =>
      query(
        collection(db, COLLECTIONS.timesheets),
        where('uid', '==', uid),
        where('status', '==', 'rejected'),
      ),
    [uid],
    {
      label: 'useRejectedSheets',
      map: (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as TimesheetDoc) }));
        list.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
        return list;
      },
      empty: [],
    },
  );
}
