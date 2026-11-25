import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { closeStaleSession, closeStaleSessions } from '../../src/sessions';
import { EMULATOR_PROJECT_ID, finishedClockEntryId, runningEntryId } from '@sabeel/shared';

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

const session = () => getFirestore().collection('timeEntries').doc(runningEntryId('alice'));
const finished = async () => (await getFirestore().collection('timeEntries')
  .where('uid', '==', 'alice').where('end', '!=', null).get()).docs.map((doc) => doc.data());

describe('closeStaleSessions', () => {
  it('replaces a >12h session with a finished entry capped at start+12h', async () => {
    await session().set(running(13 * HOUR));

    expect(await closeStaleSessions(NOW)).toBe(1);

    expect((await session().get()).exists).toBe(false);
    const [entry, ...others] = await finished();
    expect(others).toEqual([]);
    expect(entry).toMatchObject({ autoClosed: true, start: NOW - 13 * HOUR, durationMinutes: 12 * 60 });
    expect((await getFirestore().collection('timeEntries').doc(finishedClockEntryId('alice', NOW - 13 * HOUR)).get()).exists).toBe(true);
    expect(entry.end).toBe(entry.start + 12 * HOUR);
  });

  it('leaves a session running under the cap untouched', async () => {
    await session().set(running(3 * HOUR));
    expect(await closeStaleSessions(NOW)).toBe(0);
    expect((await session().get()).data()!.end).toBeNull();
  });

  it('does not touch a session clocked out and restarted after the initial scan', async () => {
    await session().set(running(13 * HOUR));
    const candidates = await getFirestore().collection('timeEntries').where('end', '==', null).get();
    // Clocked out (the session's finished entry) and in again before the job commits.
    await getFirestore().collection('timeEntries').doc(finishedClockEntryId('alice', NOW - 13 * HOUR))
      .set({ ...running(13 * HOUR), end: NOW, durationMinutes: 13 * 60 });
    await session().set(running(HOUR));

    expect(await closeStaleSession(candidates.docs[0].id, NOW)).toBe(false);
    expect((await session().get()).data()).toMatchObject({ end: null, start: NOW - HOUR });
    expect(await finished()).toEqual([expect.objectContaining({ end: NOW, durationMinutes: 13 * 60 })]);
  });

  it('does the same close exactly once when two jobs pick the same candidate', async () => {
    await session().set(running(13 * HOUR));
    const results = await Promise.all([closeStaleSession(session().id, NOW), closeStaleSession(session().id, NOW)]);
    expect(results.sort()).toEqual([false, true]);
    expect(await finished()).toHaveLength(1);
  });

  // This job runs on the admin SDK, so the approved-period lock every client
  // rule enforces does not apply to it. It must not leave an approved sheet
  // asserting a total its own entries contradict.
  it('repairs the stored snapshot when it closes an entry inside an approved period', async () => {
    const db = getFirestore();
    await session().set(running(20 * HOUR));
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
    await session().set(running(20 * HOUR));
    await closeStaleSessions(NOW);
    expect((await getFirestore().collection('timesheets').doc('alice_2026-07-12').get()).exists).toBe(false);
  });
});
