import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  SESSION_CAP_HOURS,
  minutesBetween,
  type TimeEntryDoc,
  type TimesheetDoc,
} from '@sabeel/shared';
import { reportError, reportMessage, sentryDsn } from './sentry';

const CAP_MS = SESSION_CAP_HOURS * 60 * 60 * 1000;

/**
 * Recheck a candidate after the scan. Clock-out, the active pointer and a
 * legacy sealed sheet's snapshot must agree at the end of the same write.
 */
export async function closeStaleSession(entryId: string, now: number): Promise<boolean> {
  const db = getFirestore();
  const entryRef = db.collection(COLLECTIONS.timeEntries).doc(entryId);
  const result = await db.runTransaction(async (tx) => {
    const entry = (await tx.get(entryRef)).data() as TimeEntryDoc | undefined;
    if (!entry || entry.end !== null || entry.start > now - CAP_MS) return null;

    const userRef = db.collection(COLLECTIONS.users).doc(entry.uid);
    const sheetRef = db.collection(COLLECTIONS.timesheets).doc(entry.uid + '_' + entry.periodKey);
    const [user, sheetSnap] = await tx.getAll(userRef, sheetRef);
    const sheet = sheetSnap.data() as TimesheetDoc | undefined;
    const sealed = sheet?.status === 'submitted' || sheet?.status === 'approved';
    const end = entry.start + CAP_MS;
    const durationMinutes = Math.max(1, minutesBetween(entry.start, end));
    let reconciled: { totalMinutes: number; entryCount: number } | undefined;
    if (sealed) {
      const entries = await tx.get(db.collection(COLLECTIONS.timeEntries)
        .where('uid', '==', entry.uid)
        .where('dayKey', '>=', sheet.periodKey)
        .where('dayKey', '<=', sheet.toKey));
      const closed = entries.docs.flatMap((doc) => {
        if (doc.id === entryId) return [durationMinutes];
        const row = doc.data() as TimeEntryDoc;
        return row.end === null ? [] : [row.durationMinutes ?? 0];
      });
      reconciled = { totalMinutes: closed.reduce((sum, minutes) => sum + minutes, 0), entryCount: closed.length };
    }
    tx.update(entryRef, { end, durationMinutes, autoClosed: true, updatedAt: now });
    if (user.data()?.activeEntryId === entryId) tx.update(userRef, { activeEntryId: null });
    if (reconciled) tx.update(sheetRef, { ...reconciled, updatedAt: now });
    return { entry, sheet, reconciled };
  });

  if (result?.reconciled && result.sheet) {
    const { entry, sheet, reconciled } = result;
    await reportMessage('Auto-close touched a ' + sheet.status + ' timesheet', {
      uid: entry.uid,
      periodKey: entry.periodKey,
      entryId,
      status: sheet.status,
      totalMinutes: reconciled.totalMinutes,
      previousTotalMinutes: sheet.totalMinutes,
    });
  }
  return result !== null;
}

/** Close only entries that are still stale when the write commits. */
export async function closeStaleSessions(now: number): Promise<number> {
  const snap = await getFirestore().collection(COLLECTIONS.timeEntries)
    .where('end', '==', null)
    .where('start', '<=', now - CAP_MS)
    .get();
  let closed = 0;
  for (const doc of snap.docs) {
    if (await closeStaleSession(doc.id, now)) closed++;
  }
  return closed;
}

export const autoCloseStaleSessions = onSchedule(
  { schedule: 'every 60 minutes', secrets: [sentryDsn] },
  async () => {
    try {
      const closed = await closeStaleSessions(Timestamp.now().toMillis());
      if (closed > 0) console.log(`autoCloseStaleSessions: closed ${closed} stale session(s)`);
    } catch (e) {
      await reportError(e);
      throw e;
    }
  },
);
