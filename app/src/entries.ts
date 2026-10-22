import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useLiveDoc, useLiveQuery } from './liveQuery';
import {
  addDays,
  COLLECTIONS,
  dayKeyFor,
  deviceTimeZone,
  epochFor,
  minutesBetween,
  periodKeyFor,
  timeOfDayFor,
  type TimeEntryDoc,
} from '@sabeel/shared';
import { FirebaseError } from 'firebase/app';
import { db } from './firebase';
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

/** Clock out: close the running entry and clear the pointer, atomically. */
export async function clockOut(uid: string, entry: TimeEntry): Promise<void> {
  const now = Date.now();
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTIONS.timeEntries, entry.id), {
    end: now,
    durationMinutes: Math.max(1, minutesBetween(entry.start, now)),
    updatedAt: now,
  });
  batch.update(doc(db, COLLECTIONS.users, uid), { activeEntryId: null });
  await batch.commit();
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
    durationMinutes: Math.max(1, minutesBetween(input.start, input.end)),
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
      map: (snap) => (snap.exists() ? { id: snap.id, ...(snap.data() as TimeEntryDoc) } : null),
      empty: null,
    },
  );
}

/** Live list of a user's entries in an inclusive dayKey range, newest first. */
export function useEntriesRange(
  uid: string,
  fromKey: string,
  toKey: string,
): TimeEntry[] {
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
      label: 'useEntriesRange',
      map: (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as TimeEntryDoc) }));
        list.sort((a, b) => b.dayKey.localeCompare(a.dayKey) || b.start - a.start);
        return list;
      },
      empty: [],
    },
  );
}

/** Edit a closed entry's fields; recomputes duration/dayKey from the new times. */
export async function updateEntry(
  entry: TimeEntry,
  changes: {
    activity?: Activity;
    start: number;
    end: number;
    note?: string;
    editorUid: string;
  },
): Promise<void> {
  const dayKey = dayKeyFor(changes.start, entry.timeZone);
  await updateDoc(doc(db, COLLECTIONS.timeEntries, entry.id), {
    ...(changes.activity
      ? { activityId: changes.activity.id, activityName: changes.activity.name }
      : {}),
    start: changes.start,
    end: changes.end,
    durationMinutes: Math.max(1, minutesBetween(changes.start, changes.end)),
    dayKey,
    periodKey: periodKeyFor(dayKey),
    note: changes.note?.trim() ?? '',
    updatedAt: Date.now(),
    ...(changes.editorUid !== entry.uid ? { lastEditedBy: changes.editorUid } : {}),
  });
}

export function deleteEntry(entryId: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.timeEntries, entryId));
}

/**
 * Copy last week's closed entries into a (still empty) week, one weekday later
 * by exactly seven days, preserving each entry's wall-clock start time and
 * duration in its own timezone (a +7d epoch shift would drift across DST).
 * Entries whose target day falls outside the destination period are skipped —
 * month-clipped weeks are shorter than the source week.
 */
export async function copyPeriodEntries(
  uid: string,
  fromPeriod: { fromKey: string; toKey: string },
  toPeriod: { fromKey: string; toKey: string },
): Promise<{ copied: number; skipped: number }> {
  const snap = await getDocs(
    query(
      collection(db, COLLECTIONS.timeEntries),
      where('uid', '==', uid),
      where('dayKey', '>=', fromPeriod.fromKey),
      where('dayKey', '<=', fromPeriod.toKey),
    ),
  );
  const now = Date.now();
  const batch = writeBatch(db);
  let copied = 0;
  let skipped = 0;
  for (const d of snap.docs) {
    const e = d.data() as TimeEntryDoc;
    if (e.end === null) continue; // never copy a running session
    const dayKey = addDays(e.dayKey, 7);
    if (dayKey < toPeriod.fromKey || dayKey > toPeriod.toKey) {
      skipped++;
      continue;
    }
    const start = epochFor(dayKey, timeOfDayFor(e.start, e.timeZone), e.timeZone);
    const copy: TimeEntryDoc = {
      uid,
      activityId: e.activityId,
      activityName: e.activityName,
      start,
      end: start + (e.end - e.start),
      durationMinutes: e.durationMinutes ?? Math.max(1, minutesBetween(e.start, e.end)),
      timeZone: e.timeZone,
      dayKey,
      periodKey: periodKeyFor(dayKey),
      source: 'manual',
      ...(e.note ? { note: e.note } : {}),
      createdAt: now,
      updatedAt: now,
    };
    batch.set(doc(collection(db, COLLECTIONS.timeEntries)), copy);
    copied++;
  }
  if (copied > 0) await batch.commit();
  return { copied, skipped };
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
