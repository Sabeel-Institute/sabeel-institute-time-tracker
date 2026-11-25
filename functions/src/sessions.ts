import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  finishedClockEntryId,
  SESSION_CAP_HOURS,
  minutesBetween,
  type TimeEntryDoc,
  type TimesheetDoc,
} from '@sabeel/shared';
import { reportError, reportMessage, sentryDsn } from './sentry';

const CAP_MS = SESSION_CAP_HOURS * 60 * 60 * 1000;

/**
 * Recheck a candidate after the scan. The finished entry replaces the session
 * in progress at the id the session fixes, as a clock-out does, and a legacy sealed sheet's
 * snapshot is repaired in the same write.
 */
export async function closeStaleSession(entryId: string, now: number): Promise<boolean> {
  const db = getFirestore();
  const entries = db.collection(COLLECTIONS.timeEntries);
  const sessionRef = entries.doc(entryId);
  const result = await db.runTransaction(async (tx) => {
    const session = (await tx.get(sessionRef)).data() as TimeEntryDoc | undefined;
    if (!session || session.end !== null || session.start > now - CAP_MS) return null;

    const sheetRef = db.collection(COLLECTIONS.timesheets).doc(session.uid + '_' + session.periodKey);
    const sheet = (await tx.get(sheetRef)).data() as TimesheetDoc | undefined;
    const sealed = sheet?.status === 'submitted' || sheet?.status === 'approved';
    const end = session.start + CAP_MS;
    const durationMinutes = Math.max(1, minutesBetween(session.start, end));
    let reconciled: { totalMinutes: number; entryCount: number } | undefined;
    if (sealed) {
      const rows = await tx.get(entries
        .where('uid', '==', session.uid)
        .where('dayKey', '>=', sheet.periodKey)
        .where('dayKey', '<=', sheet.toKey));
      const closed = rows.docs.flatMap((doc) => {
        if (doc.id === entryId) return [durationMinutes];
        const row = doc.data() as TimeEntryDoc;
        return row.end === null ? [] : [row.durationMinutes ?? 0];
      });
      reconciled = { totalMinutes: closed.reduce((sum, minutes) => sum + minutes, 0), entryCount: closed.length };
    }
    tx.create(entries.doc(finishedClockEntryId(session.uid, session.start)), {
      ...session, end, durationMinutes, autoClosed: true, updatedAt: now,
    });
    tx.delete(sessionRef);
    if (reconciled) tx.update(sheetRef, { ...reconciled, updatedAt: now });
    return { session, sheet, reconciled };
  });

  if (result?.reconciled && result.sheet) {
    const { session, sheet, reconciled } = result;
    await reportMessage('Auto-close touched a ' + sheet.status + ' timesheet', {
      uid: session.uid,
      periodKey: session.periodKey,
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
