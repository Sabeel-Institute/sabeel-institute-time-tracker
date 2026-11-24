import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  addDays, dayKeyFor, DEFAULT_REVIEW_LIMITS, EMULATOR_PROJECT_ID, periodRangeFor, reviewTimesheet,
  timesheetEntriesVersion, timesheetReviewVersion, timesheetRevision,
  type TimeEntryDoc, type TimesheetDoc,
} from '@sabeel/shared';
import { submitReviewed } from '../../src/timesheetActions';

const uid = 'member';
const approverUid = 'reviewer';
const period = periodRangeFor('2026-07-13');
const sheetRef = () => getFirestore().doc('timesheets/' + uid + '_' + period.fromKey);
const entry = {
  id: 'early', uid, dayKey: '2026-07-13', periodKey: period.fromKey, source: 'manual',
  activityId: 'setup', activityName: 'Setup', timeZone: 'UTC',
  start: Date.UTC(2026, 6, 13, 12), end: Date.UTC(2026, 6, 13, 13),
  durationMinutes: 60, createdAt: 1, updatedAt: 1,
} satisfies TimeEntryDoc & { id: string };

function request(entries: (TimeEntryDoc & { id: string })[], sheet?: TimesheetDoc) {
  return {
    approverUid, periodKey: period.fromKey, sheetVersion: sheet ? timesheetRevision(sheet) : null,
    entriesVersion: timesheetEntriesVersion(entries),
    reviewVersion: timesheetReviewVersion(entries.some((row) => row.end !== null)
      ? reviewTimesheet(DEFAULT_REVIEW_LIMITS, entries, period) : undefined),
  };
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
  await db.doc('users/' + uid).set({ status: 'active', role: 'member', approverUid });
  await db.doc('users/' + approverUid).set({ status: 'active', role: 'manager' });
});

describe('submission checks the exact hours the member reviewed', () => {
  it('refuses an empty snapshot after hours appear, then submits the actual hours', async () => {
    await getFirestore().doc('timeEntries/' + entry.id).set(entry);
    await expect(submitReviewed(request([]), uid, false)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await sheetRef().get()).exists).toBe(false);
    await submitReviewed(request([entry]), uid, false);
    expect((await sheetRef().get()).data()).toMatchObject({ status: 'submitted', totalMinutes: 60, entryCount: 1 });
  });

  it('records only one submission when two sessions submit the same draft', async () => {
    const input = request([]);
    const results = await Promise.allSettled([submitReviewed(input, uid, false), submitReviewed(input, uid, false)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results).toContainEqual(expect.objectContaining({ status: 'rejected',
      reason: expect.objectContaining({ code: 'failed-precondition' }),
    }));
    const recorded = (await sheetRef().get()).data();
    expect(recorded).toMatchObject({ status: 'submitted', entryCount: 0, totalMinutes: 0 });
    await expect(submitReviewed(input, uid, false)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await sheetRef().get()).data()).toEqual(recorded);
  });

  it('accepts an empty week without a review and preserves empty resubmission after rejection', async () => {
    await getFirestore().doc('config/timesheetReview').set({ ...DEFAULT_REVIEW_LIMITS, maxEntryMinutes: 60 });
    await getFirestore().doc('timeEntries/neighboring-timer').set({
      ...entry, id: 'neighboring-timer', dayKey: '2026-07-11', periodKey: '2026-07-05',
      start: Date.UTC(2026, 6, 11, 23), end: null,
    });
    await submitReviewed(request([]), uid, false);
    const original = (await sheetRef().get()).data() as TimesheetDoc;
    expect(original).toMatchObject({ status: 'submitted', totalMinutes: 0, entryCount: 0 });
    expect(original.submissionReview).toBeUndefined();

    const rejected: TimesheetDoc = {
      ...original, status: 'rejected', decidedAt: 1, decidedBy: approverUid, rejectReason: 'Check hours',
      submissionReview: { limits: DEFAULT_REVIEW_LIMITS, flags: [], at: original.submittedAt },
    };
    await sheetRef().set(rejected);
    await expect(submitReviewed(request([], original), uid, false)).rejects.toMatchObject({ code: 'failed-precondition' });
    await submitReviewed(request([], rejected), uid, false);
    const resubmitted = (await sheetRef().get()).data();
    expect(resubmitted).toMatchObject({ status: 'submitted', totalMinutes: 0, entryCount: 0, createdAt: original.createdAt });
    expect(resubmitted).not.toHaveProperty('submissionReview');
    expect(resubmitted).not.toHaveProperty('rejectReason');
  });

  it('will not stamp an approver who has since lost the role or someone no longer selected', async () => {
    const db = getFirestore();
    await db.doc('users/' + approverUid).update({ role: 'member' });
    await expect(submitReviewed(request([]), uid, false)).rejects.toThrow('Choose an active approver');
    await db.doc('users/' + approverUid).update({ role: 'manager' });
    await db.doc('users/' + uid).update({ approverUid: 'different-person' });
    await expect(submitReviewed(request([]), uid, false)).rejects.toThrow('Choose an active approver');
    expect((await sheetRef().get()).exists).toBe(false);
  });

  it('preserves admin self-submission without a selection when the current role and claim agree', async () => {
    const owner = getFirestore().doc('users/' + uid);
    const input = { ...request([]), approverUid: uid };
    await owner.update({ approverUid: null, admin: true });
    await expect(submitReviewed(input, uid, false)).rejects.toThrow('Choose an active approver');
    await owner.update({ admin: false });
    await expect(submitReviewed(input, uid, true)).rejects.toThrow('Choose an active approver');
    await owner.update({ admin: true });
    await submitReviewed(input, uid, true);
    expect((await sheetRef().get()).data()).toMatchObject({ status: 'submitted', approverUid: uid });
  });

  it('leaves future periods and inactive members without a submission', async () => {
    const db = getFirestore();
    const future = periodRangeFor(addDays(dayKeyFor(Date.now(), 'UTC'), 14)).fromKey;
    await expect(submitReviewed({ ...request([]), periodKey: future }, uid, false)).rejects.toThrow('has not started');
    await db.doc('users/' + uid).update({ status: 'disabled' });
    await expect(submitReviewed(request([]), uid, false)).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.collection('timesheets').where('uid', '==', uid).get()).empty).toBe(true);
  });

  it('refuses overlaps and running timers even when the caller has seen the same version', async () => {
    const duplicate = { ...entry, id: 'late' };
    const db = getFirestore();
    await db.doc('timeEntries/' + entry.id).set(entry);
    await db.doc('timeEntries/' + duplicate.id).set(duplicate);
    await expect(submitReviewed(request([entry, duplicate]), uid, false)).rejects.toThrow('Fix overlapping entries');
    const running = { ...duplicate, end: null };
    await db.doc('timeEntries/' + running.id).set(running);
    await expect(submitReviewed(request([entry, running]), uid, false)).rejects.toThrow('still has a running timer');
  });
});
