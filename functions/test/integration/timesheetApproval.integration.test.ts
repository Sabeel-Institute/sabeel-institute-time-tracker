import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  DEFAULT_REVIEW_LIMITS,
  EMULATOR_PROJECT_ID,
  periodRangeFor,
  reviewTimesheet,
  timesheetEntriesVersion,
  timesheetReviewVersion,
  timesheetRevision,
  type TimesheetDoc,
  type TimeEntryDoc,
} from '@sabeel/shared';
import { approveReviewed } from '../../src/timesheetActions';

const period = periodRangeFor('2026-07-13');
const sheet: TimesheetDoc = {
  uid: 'member', status: 'submitted', periodKey: period.fromKey, toKey: period.toKey,
  approverUid: 'reviewer', submittedAt: 2, createdAt: 2, updatedAt: 2,
  totalMinutes: 0, entryCount: 0,
};
const row = (id: string, start: number, end: number | null): TimeEntryDoc & { id: string } => ({
  uid: sheet.uid, activityId: 'tutoring', activityName: 'Tutoring', source: 'manual',
  id, timeZone: 'UTC', start, end, createdAt: 1, updatedAt: 1,
  dayKey: new Date(start).toISOString().slice(0, 10), periodKey: periodRangeFor(new Date(start).toISOString().slice(0, 10)).fromKey,
  ...(end === null ? {} : { durationMinutes: (end - start) / 60000 }),
});
const time = (hour: number) => Date.UTC(2026, 6, 12, hour);
const sheetRef = () => getFirestore().collection('timesheets').doc(sheet.uid + '_' + sheet.periodKey);

function request(entries: ReturnType<typeof row>[], nearby = entries) {
  return {
    uid: sheet.uid, periodKey: sheet.periodKey, sheetVersion: timesheetRevision(sheet),
    entriesVersion: timesheetEntriesVersion(entries),
    reviewVersion: timesheetReviewVersion(entries.some((entry) => entry.end !== null)
      ? reviewTimesheet(DEFAULT_REVIEW_LIMITS, nearby, period) : undefined),
  };
}

async function store(entry: ReturnType<typeof row>) {
  const { id, ...data } = entry;
  await getFirestore().collection('timeEntries').doc(id).set(data);
}

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

beforeEach(async () => {
  const db = getFirestore();
  await Promise.all(['timesheets', 'timeEntries', 'users', 'config'].map(async (name) => {
    const docs = (await db.collection(name).get()).docs;
    await Promise.all(docs.map((doc) => doc.ref.delete()));
  }));
  await sheetRef().set(sheet);
  await db.collection('users').doc('reviewer').set({ status: 'active', role: 'manager' });
});

describe('approval checks the exact hours the approver saw', () => {
  it('approves an empty sheet with zero totals regardless of threshold changes', async () => {
    await getFirestore().doc('config/timesheetReview').set({ ...DEFAULT_REVIEW_LIMITS, maxEntryMinutes: 60 });
    await approveReviewed(request([]), 'reviewer', 'manager');
    expect((await sheetRef().get()).data()).toMatchObject({ status: 'approved', entryCount: 0, totalMinutes: 0 });
    expect((await sheetRef().get()).data()).not.toHaveProperty('approvalReview');
  });

  it('refuses hours added after an empty review, then approves the actual total on retry', async () => {
    const added = row('late', time(10), time(11));
    await store(added);
    await expect(approveReviewed(request([]), 'reviewer', 'manager')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await sheetRef().get()).data()?.status).toBe('submitted');
    await approveReviewed(request([added]), 'reviewer', 'manager');
    expect((await sheetRef().get()).data()).toMatchObject({ status: 'approved', entryCount: 1, totalMinutes: 60 });
  });

  it('detects a note correction with the same count, timestamps, and minutes', async () => {
    const old = row('edited', time(10), time(11));
    await store({ ...old, note: 'Corrected activity detail' });
    await expect(approveReviewed(request([old]), 'reviewer', 'manager')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await sheetRef().get()).data()?.status).toBe('submitted');
  });

  it('refuses overlap across periods and a running timer', async () => {
    const inside = row('after midnight', time(0), time(1));
    const other = row('previous period', time(-1), time(0) + 30 * 60000);
    await store(inside);
    await store(other);
    await expect(approveReviewed(request([inside], [inside, other]), 'reviewer', 'manager'))
      .rejects.toThrow('Fix overlapping entries');
    await getFirestore().collection('timeEntries').doc(other.id).delete();
    const running = row('running', time(4), null);
    await store(running);
    await expect(approveReviewed(request([inside, running]), 'reviewer', 'manager'))
      .rejects.toThrow('still has a running timer');
    expect((await sheetRef().get()).data()?.status).toBe('submitted');
  });

  it('requires the current assigned approver or an active admin', async () => {
    await getFirestore().doc('users/other').set({ status: 'active', role: 'manager', admin: false });
    await expect(approveReviewed(request([]), 'other', 'manager')).rejects.toMatchObject({ code: 'permission-denied' });
    await getFirestore().doc('users/reviewer').update({ status: 'disabled' });
    await expect(approveReviewed(request([]), 'reviewer', 'manager')).rejects.toMatchObject({ code: 'permission-denied' });
    await getFirestore().doc('users/other').update({ admin: true });
    await approveReviewed(request([]), 'other', 'admin');
    expect((await sheetRef().get()).data()?.decidedBy).toBe('other');
  });

  it('rejects an outdated duration review when thresholds change after confirmation', async () => {
    const added = row('long', time(9), time(11));
    await store(added);
    await getFirestore().doc('config/timesheetReview').set({ ...DEFAULT_REVIEW_LIMITS, maxEntryMinutes: 90 });
    await expect(approveReviewed(request([added]), 'reviewer', 'manager')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await sheetRef().get()).data()?.status).toBe('submitted');
  });
});
