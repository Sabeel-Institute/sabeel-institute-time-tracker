import {
  addDoc,
  collection,
  doc,
  query,
  runTransaction,
  where,
  writeBatch,
  type QuerySnapshot,
} from 'firebase/firestore';
import { useLiveDoc, useLiveQuery } from './liveQuery';
import {
  COLLECTIONS,
  dayKeyFor,
  deviceTimeZone,
  entryMinutes,
  patchApplied,
  periodKeyFor,
  timeEntryRevision,
  type TimeEntryDoc,
  type UserDoc,
} from '@sabeel/shared';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import type { Activity } from './activities';

export type TimeEntry = TimeEntryDoc & { id: string };

/**
 * Entry writes into a submitted/approved period are denied by rules; turn the
 * opaque permission error into the message users need to see.
 */
export function explainEntryWriteError(e: unknown): string {
  if (e instanceof FirebaseError && e.code === 'permission-denied') {
    return (
      "This week's timesheet has been submitted or approved, so its hours are " +
      'locked. Withdraw the timesheet (or ask your approver / an admin) to make changes.'
    );
  }
  return (e as Error).message;
}

/** Clock in: create the running entry and point activeEntryId at it, atomically. */
export async function clockIn(uid: string, activity: Activity): Promise<void> {
  const now = Date.now();
  const tz = deviceTimeZone();
  const entryRef = doc(collection(db, COLLECTIONS.timeEntries));
  const dayKey = dayKeyFor(now, tz);
  const entry: TimeEntryDoc = {
    uid,
    activityId: activity.id,
    activityName: activity.name,
    start: now,
    end: null,
    timeZone: tz,
    dayKey,
    periodKey: periodKeyFor(dayKey),
    source: 'clock',
    createdAt: now,
    updatedAt: now,
  };
  const batch = writeBatch(db);
  batch.set(entryRef, entry);
  batch.update(doc(db, COLLECTIONS.users, uid), { activeEntryId: entryRef.id });
  await batch.commit();
}

/** End the timer only if both it and the latest pointer still agree. */
export async function clockOut(uid: string, entry: TimeEntry): Promise<void> {
  const now = Date.now();
  const entryRef = doc(db, COLLECTIONS.timeEntries, entry.id);
  const userRef = doc(db, COLLECTIONS.users, uid);
  await runTransaction(db, async (tx) => {
    const [currentSnap, userSnap] = await Promise.all([tx.get(entryRef), tx.get(userRef)]);
    const current = currentSnap.data() as TimeEntryDoc | undefined;
    const user = userSnap.data() as UserDoc | undefined;
    // A scheduler or another device may have closed this session and started
    // a new one while this screen was still showing the previous timer.
    if (user?.activeEntryId !== entry.id) return;
    if (current?.uid === uid && current.end === null) {
      tx.update(entryRef, { end: now, durationMinutes: entryMinutes(current.start, now), updatedAt: now });
    }
    tx.update(userRef, { activeEntryId: null });
  });
}

export async function createManualEntry(input: {
  uid: string;
  activity: Activity;
  start: number;
  end: number;
  note?: string;
  /**
   * The timezone the work happened in — the TARGET user's, not the writer's.
   * A manager in Chicago logging 9–5 for someone in Singapore must record
   * Singapore's 9–5, or the entry lands on the wrong local day (and near a week
   * boundary, in the wrong timesheet period). The caller resolves it; see
   * ManualEntryScreen.
   */
  timeZone: string;
  /** Who is writing. When ≠ uid (manager/approver adding on behalf), rules require the lastEditedBy flag. */
  creatorUid: string;
}): Promise<void> {
  const now = Date.now();
  const tz = input.timeZone;
  const dayKey = dayKeyFor(input.start, tz);
  const entry: TimeEntryDoc = {
    uid: input.uid,
    activityId: input.activity.id,
    activityName: input.activity.name,
    start: input.start,
    end: input.end,
    durationMinutes: entryMinutes(input.start, input.end),
    timeZone: tz,
    dayKey,
    periodKey: periodKeyFor(dayKey),
    source: 'manual',
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.creatorUid !== input.uid ? { lastEditedBy: input.creatorUid } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await addDoc(collection(db, COLLECTIONS.timeEntries), entry);
}

/** Live view of a single entry (the running one, usually). */
export function useEntry(entryId: string | null): TimeEntry | null {
  return useLiveDoc(
    () => (entryId ? doc(db, COLLECTIONS.timeEntries, entryId) : null),
    [entryId],
    {
      label: 'useEntry',
      map: (snap) => (snap.exists() ? { ...(snap.data() as TimeEntryDoc), id: snap.id } : null),
      empty: null,
    },
  );
}

/**
 * Live list of a user's entries in an inclusive dayKey range, newest first.
 * undefined = still loading (or the listen failed, which the banner says).
 */
export function useEntriesRange(
  uid: string,
  fromKey: string,
  toKey: string,
): TimeEntry[] | undefined {
  return useLiveQuery<TimeEntry[] | undefined>(
    () => entriesRangeQuery(uid, fromKey, toKey),
    [uid, fromKey, toKey],
    { label: 'useEntriesRange', map: (snap) => entryRows(snap), empty: undefined },
  );
}

/**
 * The same rows once the server has confirmed them, and whether it still
 * does: `synced` turns false when the connection drops, and the rows stay on
 * screen. An action that seals the week waits for `synced`.
 */
export function useSyncedEntriesRange(
  uid: string,
  fromKey: string,
  toKey: string,
): { rows: TimeEntry[]; synced: boolean } | undefined {
  return useLiveQuery<{ rows: TimeEntry[]; synced: boolean } | undefined>(
    () => entriesRangeQuery(uid, fromKey, toKey),
    [uid, fromKey, toKey],
    {
      label: 'useSyncedEntriesRange',
      waitForServer: true,
      map: (snap) => ({ rows: entryRows(snap), synced: !snap.metadata.fromCache }),
      empty: undefined,
    },
  );
}

function entriesRangeQuery(uid: string, fromKey: string, toKey: string) {
  return query(
    collection(db, COLLECTIONS.timeEntries),
    where('uid', '==', uid),
    where('dayKey', '>=', fromKey),
    where('dayKey', '<=', toKey),
  );
}

function entryRows(snap: QuerySnapshot): TimeEntry[] {
  const list = snap.docs.map((d) => ({ ...(d.data() as TimeEntryDoc), id: d.id }));
  list.sort((a, b) => b.dayKey.localeCompare(a.dayKey) || b.start - a.start);
  return list;
}

export const ENTRY_CHANGED = 'This entry changed while you were editing. Load the latest entry and review it again.';

function changeEntry(entry: TimeEntry, patch?: Record<string, unknown>): Promise<void> {
  const ref = doc(db, COLLECTIONS.timeEntries, entry.id);
  return runTransaction(db, async (tx) => {
    const current = (await tx.get(ref)).data() as TimeEntryDoc | undefined;
    // A retried commit finds its own write (patchApplied): success, not a conflict.
    if (patch ? patchApplied(current, patch) : !current) return;
    if (!current || timeEntryRevision({ ...current, id: entry.id }) !== timeEntryRevision(entry)) {
      throw new Error(ENTRY_CHANGED);
    }
    if (patch) tx.update(ref, patch);
    else tx.delete(ref);
  });
}

/** Edit a closed entry's fields; recomputes duration/dayKey from the new times. */
export async function updateEntry(
  entry: TimeEntry,
  changes: {
    activity?: Activity;
    start: number;
    end: number;
    note?: string;
    timeZone?: string;
    editorUid: string;
  },
): Promise<void> {
  const timeZone = changes.timeZone ?? entry.timeZone;
  const dayKey = dayKeyFor(changes.start, timeZone);
  await changeEntry(entry, {
    ...(changes.activity
      ? { activityId: changes.activity.id, activityName: changes.activity.name }
      : {}),
    ...(timeZone !== entry.timeZone ? { timeZone } : {}),
    start: changes.start,
    end: changes.end,
    durationMinutes: entryMinutes(changes.start, changes.end),
    dayKey,
    periodKey: periodKeyFor(dayKey),
    note: changes.note?.trim() ?? '',
    updatedAt: Date.now(),
    ...(changes.editorUid !== entry.uid ? { lastEditedBy: changes.editorUid } : {}),
  });
}

export function deleteEntry(entry: TimeEntry): Promise<void> {
  return changeEntry(entry);
}

/** Copy only if the destination remains an empty draft at commit time. */
export async function copyPeriodEntries(periodKey: string): Promise<{ copied: number; skipped: number }> {
  const response = await httpsCallable<{ periodKey: string }, { copied: number; skipped: number }>(
    functions, 'copyPreviousTimesheetWeek',
  )({ periodKey });
  return response.data;
}

/**
 * Live set of periodKeys (in an inclusive dayKey range) that have ANY entries —
 * lets the week navigator distinguish "hours logged, not submitted" from
 * "empty week" without loading every entry's fields.
 */
export function useEntryPeriods(uid: string, fromKey: string, toKey: string): Set<string> {
  return useLiveQuery(
    () =>
      query(
        collection(db, COLLECTIONS.timeEntries),
        where('uid', '==', uid),
        where('dayKey', '>=', fromKey),
        where('dayKey', '<=', toKey),
      ),
    [uid, fromKey, toKey],
    {
      label: 'useEntryPeriods',
      map: (snap) => new Set(snap.docs.map((d) => (d.data() as TimeEntryDoc).periodKey)),
      empty: new Set<string>(),
    },
  );
}

/** Live closed-minutes total for one of my local days (running session excluded). */
export function useDayMinutes(uid: string, dayKey: string): number {
  return useLiveQuery(
    () =>
      query(
        collection(db, COLLECTIONS.timeEntries),
        where('uid', '==', uid),
        where('dayKey', '==', dayKey),
      ),
    [uid, dayKey],
    {
      label: 'useDayMinutes',
      map: (snap) => {
        let total = 0;
        snap.forEach((d) => {
          total += (d.data() as TimeEntryDoc).durationMinutes ?? 0;
        });
        return total;
      },
      empty: 0,
    },
  );
}
