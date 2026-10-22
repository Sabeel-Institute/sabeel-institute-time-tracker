import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { closeStaleSessions } from '../../src/sessions';
import { EMULATOR_PROJECT_ID } from '@sabeel/shared';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 15, 20, 0);

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

async function reset() {
  const db = getFirestore();
  for (const c of ['timeEntries', 'users', 'timesheets']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

const running = (startMsAgo: number) => ({
  uid: 'alice',
  activityId: 'a',
  activityName: 'Tutoring',
  start: NOW - startMsAgo,
  end: null,
  timeZone: 'America/Chicago',
  dayKey: '2026-07-15',
  periodKey: '2026-07-12',
  source: 'clock',
  createdAt: 1,
  updatedAt: 1,
});

beforeEach(reset);

describe('closeStaleSessions', () => {
  it('caps a >12h running session at start+12h, clears the pointer', async () => {
    const db = getFirestore();
    const ref = await db.collection('timeEntries').add(running(13 * HOUR));
    await db.collection('users').doc('alice').set({ activeEntryId: ref.id, status: 'active' });

    const closed = await closeStaleSessions(NOW);
    expect(closed).toBe(1);

    const entry = (await ref.get()).data()!;
    expect(entry.autoClosed).toBe(true);
    expect(entry.end).toBe(entry.start + 12 * HOUR);
    expect(entry.durationMinutes).toBe(12 * 60);

    const user = (await db.collection('users').doc('alice').get()).data()!;
    expect(user.activeEntryId).toBeNull();
  });

  it('leaves a session running under the cap untouched', async () => {
    const db = getFirestore();
    const ref = await db.collection('timeEntries').add(running(3 * HOUR));
    await db.collection('users').doc('alice').set({ activeEntryId: ref.id, status: 'active' });

    const closed = await closeStaleSessions(NOW);
    expect(closed).toBe(0);
    expect((await ref.get()).data()!.end).toBeNull();
  });

  // This job runs on the admin SDK, so the approved-period lock every client
  // rule enforces does not apply to it. It must not leave an approved sheet
  // asserting a total its own entries contradict.
  it('repairs the stored snapshot when it closes an entry inside an approved period', async () => {
    const db = getFirestore();
    const ref = await db.collection('timeEntries').add(running(20 * HOUR));
    await db.collection('users').doc('alice').set({ activeEntryId: ref.id, status: 'active' });
    await db.collection('timesheets').doc('alice_2026-07-12').set({
      uid: 'alice',
      periodKey: '2026-07-12',
      toKey: '2026-07-18',
      status: 'approved',
      approverUid: 'mgr',
      submittedAt: 1,
      decidedAt: 2,
      decidedBy: 'mgr',
      totalMinutes: 0, // approved believing the period was empty
      entryCount: 0,
      createdAt: 1,
      updatedAt: 1,
    });

    await closeStaleSessions(NOW);

    const sheet = (await db.collection('timesheets').doc('alice_2026-07-12').get()).data()!;
    expect(sheet.totalMinutes).toBe(12 * 60);
    expect(sheet.entryCount).toBe(1);
    expect(sheet.status).toBe('approved'); // repaired, never silently reopened
  });

  it('leaves a draft period alone (no timesheet to repair)', async () => {
    const db = getFirestore();
    const ref = await db.collection('timeEntries').add(running(20 * HOUR));
    await db.collection('users').doc('alice').set({ activeEntryId: ref.id, status: 'active' });

    await closeStaleSessions(NOW);

    expect((await db.collection('timesheets').doc('alice_2026-07-12').get()).exists).toBe(false);
  });

  it("does not clear the pointer if it moved to a different entry", async () => {
    const db = getFirestore();
    const ref = await db.collection('timeEntries').add(running(20 * HOUR));
    await db.collection('users').doc('alice').set({ activeEntryId: 'someOther', status: 'active' });

    await closeStaleSessions(NOW);
    expect((await ref.get()).data()!.autoClosed).toBe(true);
    expect((await db.collection('users').doc('alice').get()).data()!.activeEntryId).toBe(
      'someOther',
    );
  });
});
