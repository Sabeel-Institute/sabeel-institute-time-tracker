import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  addDays,
  COLLECTIONS,
  dayKeyFor,
  entryDisplayTimeZone,
  entryMinutes,
  entryTimesValid,
  epochFor,
  isDayKey,
  MAX_ENTRY_HOURS,
  periodRangeFor,
  timeOfDayFor,
  type TimeEntryDoc,
} from '@sabeel/shared';
import { requireActive } from './auth';
import { guarded, sentryDsn } from './sentry';

type Period = ReturnType<typeof periodRangeFor>;

function entryQuery(uid: string, period: Period) {
  return getFirestore().collection(COLLECTIONS.timeEntries)
    .where('uid', '==', uid)
    .where('dayKey', '>=', period.fromKey)
    .where('dayKey', '<=', period.toKey);
}

/** Copy into an empty draft. Both eligibility checks and writes share the transaction. */
export async function copyPreviousWeek(uid: string, periodKey: unknown) {
  if (!isDayKey(periodKey)) throw new HttpsError('invalid-argument', 'Invalid destination week.');
  const period = periodRangeFor(periodKey);
  if (periodKey !== period.fromKey) throw new HttpsError('invalid-argument', 'Invalid destination week.');
  const previous = periodRangeFor(addDays(period.fromKey, -1));
  const db = getFirestore();
  const sheetRef = db.collection(COLLECTIONS.timesheets).doc(uid + '_' + period.fromKey);
  const userRef = db.collection(COLLECTIONS.users).doc(uid);

  return db.runTransaction(async (tx) => {
    const [user, sheet] = await tx.getAll(userRef, sheetRef);
    if (user.data()?.status !== 'active') throw new HttpsError('permission-denied', 'Account is not active.');
    if (sheet.exists || !(await tx.get(entryQuery(uid, period).limit(1))).empty) {
      throw new HttpsError('failed-precondition', 'You can only copy hours into an empty draft week.');
    }

    const source = await tx.get(entryQuery(uid, previous));
    const copies: TimeEntryDoc[] = [];
    let skipped = 0;
    const now = Date.now();
    for (const doc of source.docs) {
      const entry = doc.data() as TimeEntryDoc;
      if (entry.end === null) continue;
      const dayKey = addDays(entry.dayKey, 7);
      if (dayKey < period.fromKey || dayKey > period.toKey) {
        skipped++;
        continue;
      }
      const durationMinutes = entry.durationMinutes ?? entryMinutes(entry.start, entry.end);
      if (!entryTimesValid(entry) || entryDisplayTimeZone(entry.timeZone) !== entry.timeZone
          || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > MAX_ENTRY_HOURS * 60
          || durationMinutes > (entry.end - entry.start) / 60000 + 1) {
        throw new HttpsError('failed-precondition', 'Check the times and time zone of the entries in the previous week before copying.');
      }
      const start = epochFor(dayKey, timeOfDayFor(entry.start, entry.timeZone), entry.timeZone);
      if (dayKeyFor(start, entry.timeZone) !== dayKey) {
        skipped++;
        continue;
      }
      const end = start + entry.end - entry.start;
      copies.push({
        uid, start, end, dayKey, periodKey,
        activityId: entry.activityId, activityName: entry.activityName,
        timeZone: entry.timeZone, source: 'manual',
        durationMinutes,
        ...(entry.note ? { note: entry.note } : {}),
        createdAt: now, updatedAt: now,
      });
    }

    const activities = [...new Set(copies.map((entry) => entry.activityId))];
    if (activities.length > 0) {
      const refs = activities.map((id) => db.collection(COLLECTIONS.activities).doc(id));
      if ((await tx.getAll(...refs)).some((activity) => !activity.exists)) {
        throw new HttpsError('failed-precondition', 'An activity from the previous week is no longer available.');
      }
    }
    for (const entry of copies) tx.create(db.collection(COLLECTIONS.timeEntries).doc(), entry);
    return { copied: copies.length, skipped };
  });
}

export const copyPreviousTimesheetWeek = onCall(
  { secrets: [sentryDsn] },
  guarded((req) => copyPreviousWeek(requireActive(req), (req.data as { periodKey?: unknown } | undefined)?.periodKey)),
);
