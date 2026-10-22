import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runHealthCheck } from '../../src/health';
import { EMULATOR_PROJECT_ID } from '@sabeel/shared';

// Runs under `firebase emulators:exec` — FIRESTORE_EMULATOR_HOST is set, so the
// admin SDK talks to the emulator. Exercises the real count() aggregation and
// the meta/health baseline round-trip.

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

async function wipe(names: string[]) {
  const db = getFirestore();
  for (const n of names) {
    const snap = await db.collection(n).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await db.doc('meta/health').delete().catch(() => undefined);
}

async function seedEntries(n: number) {
  const db = getFirestore();
  await Promise.all(
    Array.from({ length: n }, (_, i) =>
      db.collection('timeEntries').doc(`e${i}`).set({ uid: 'alice', dayKey: '2026-07-20' }),
    ),
  );
}

beforeEach(async () => {
  await wipe(['timeEntries', 'users', 'activities', 'timesheets', 'reports']);
});

describe('runHealthCheck', () => {
  it('counts every collection and stores the baseline', async () => {
    await seedEntries(3);
    await getFirestore().collection('users').doc('alice').set({ email: 'a@oursabeel.com' });

    const { counts, findings } = await runHealthCheck(1000);

    expect(counts).toEqual({
      users: 1,
      activities: 0,
      timeEntries: 3,
      timesheets: 0,
      timesheetEvents: 0,
      reports: 0,
    });
    // First run has no baseline to compare against.
    expect(findings).toEqual([]);

    const stored = await getFirestore().doc('meta/health').get();
    expect(stored.exists).toBe(true);
    expect(stored.data()).toMatchObject({ checkedAt: 1000, counts });
  });

  it('stays silent when data grows between runs', async () => {
    await seedEntries(3);
    await runHealthCheck(1000);
    await seedEntries(9); // e0..e8 — now 9 docs
    const { findings } = await runHealthCheck(2000);
    expect(findings).toEqual([]);
  });

  it('flags a large drop against the stored baseline', async () => {
    await seedEntries(30);
    await runHealthCheck(1000);

    // Delete 25 of 30 — far past max(5, 20% of 30 = 6).
    const db = getFirestore();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => db.collection('timeEntries').doc(`e${i}`).delete()),
    );

    const { findings } = await runHealthCheck(2000);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      collection: 'timeEntries',
      previous: 30,
      current: 5,
      dropped: 25,
    });
  });

  it('re-baselines after a finding so one bad day does not alert forever', async () => {
    await seedEntries(30);
    await runHealthCheck(1000);
    const db = getFirestore();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => db.collection('timeEntries').doc(`e${i}`).delete()),
    );
    expect((await runHealthCheck(2000)).findings).toHaveLength(1);
    // Nothing changed since; the next run compares against the NEW baseline.
    expect((await runHealthCheck(3000)).findings).toEqual([]);
  });
});
