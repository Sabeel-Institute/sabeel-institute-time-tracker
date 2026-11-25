import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { EMULATOR_PROJECT_ID, type TimeEntryDoc } from '@sabeel/shared';
import { copyPreviousWeek } from '../../src/timesheetCopy';

const previous = '2026-07-12';
const target = '2026-07-19';
const uid = 'volunteer';
const entries = () => getFirestore().collection('timeEntries');
const destination = () => entries().where('uid', '==', uid).where('periodKey', '==', target).get();

const original: TimeEntryDoc = {
  uid, activityId: 'setup', activityName: 'Setup', timeZone: 'UTC', source: 'manual',
  start: Date.UTC(2026, 6, 13, 12), end: Date.UTC(2026, 6, 13, 13), durationMinutes: 60,
  dayKey: '2026-07-13', periodKey: previous, note: 'Original note', createdAt: 1, updatedAt: 1,
};

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

beforeEach(async () => {
  const db = getFirestore();
  await Promise.all(['timesheets', 'timeEntries', 'users', 'activities'].map(async (name) => {
    const docs = (await db.collection(name).get()).docs;
    await Promise.all(docs.map((doc) => doc.ref.delete()));
  }));
  await db.doc('users/' + uid).set({ status: 'active' });
  await db.doc('activities/setup').set({ name: 'Setup', status: 'active' });
  await entries().doc('original').set(original);
});

describe('copy previous week', () => {
  it('allows only one copy when simultaneous requests target an empty week', async () => {
    const results = await Promise.allSettled([copyPreviousWeek(uid, target), copyPreviousWeek(uid, target)]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const [copied] = (await destination()).docs;
    expect((await destination()).size).toBe(1);
    expect(copied.data()).toMatchObject({ dayKey: '2026-07-20', durationMinutes: 60, note: original.note });
  });

  it('copies only matching weekdays in a clipped period and preserves recorded minutes', async () => {
    const entry = { ...original, periodKey: '2026-07-26', dayKey: '2026-07-27',
      start: Date.UTC(2026, 6, 27, 12), end: Date.UTC(2026, 6, 27, 13), durationMinutes: 55 };
    await entries().doc('before-clipped-boundary').set(entry);
    // August 1 is a one-day period. No weekday in the preceding July 26–31
    // period has a +7-day copy in that clipped range.
    expect(await copyPreviousWeek(uid, '2026-08-01')).toEqual({ copied: 0, skipped: 1 });
    await entries().doc('original').update({ durationMinutes: 55 });
    expect(await copyPreviousWeek(uid, target)).toEqual({ copied: 1, skipped: 0 });
    const [copied] = (await destination()).docs;
    expect(copied.data().durationMinutes).toBe(55);
  });

  it('skips a legacy row it cannot copy instead of refusing the whole week', async () => {
    await entries().doc('legacy-zone').set({ ...original, timeZone: 'Etc/Unknown', note: 'legacy' });
    await entries().doc('bad-minutes').set({ ...original, durationMinutes: 999, note: 'bad minutes',
      start: Date.UTC(2026, 6, 14, 12), end: Date.UTC(2026, 6, 14, 13), dayKey: '2026-07-14' });
    expect(await copyPreviousWeek(uid, target)).toEqual({ copied: 1, skipped: 2 });
    expect((await destination()).docs.map((doc) => doc.data().note)).toEqual([original.note]);
  });

  it('preserves a manual entry added before the copy and keeps existing hours unchanged', async () => {
    await entries().doc('manual').set({ ...original, periodKey: target, dayKey: '2026-07-20', note: 'New manual entry' });
    await expect(copyPreviousWeek(uid, target)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await destination()).docs.map((entry) => entry.data().note)).toEqual(['New manual entry']);
  });

  it('rejects locked, inactive and invalid destinations even if they contain no hours', async () => {
    const db = getFirestore();
    const lock = db.doc('timesheets/' + uid + '_' + target);
    await lock.set({ status: 'submitted' });
    await expect(copyPreviousWeek(uid, target)).rejects.toMatchObject({ code: 'failed-precondition' });
    await lock.delete();
    await expect(copyPreviousWeek(uid, '2026-07-20')).rejects.toMatchObject({ code: 'invalid-argument' });
    await db.doc('users/' + uid).update({ status: 'disabled' });
    await expect(copyPreviousWeek(uid, target)).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await destination()).empty).toBe(true);
  });
});
