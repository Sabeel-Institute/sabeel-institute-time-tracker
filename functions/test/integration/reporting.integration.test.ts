import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildCsv, computeTotals } from '../../src/reporting';
import { EMULATOR_PROJECT_ID } from '@sabeel/shared';

const T = (dayKey: string, hhmmUTC: string) => {
  const [y, m, d] = dayKey.split('-').map(Number);
  const [h, min] = hhmmUTC.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, min);
};

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

// dayKeys 2026-07-12..18 → period 2026-07-12; 2026-07-01..04 → clipped period
// 2026-07-01 (July 2026 starts Wednesday).
const approvedSheet = (uid: string, periodKey: string, toKey: string) => ({
  uid,
  periodKey,
  toKey,
  status: 'approved',
  approverUid: 'mgr',
  submittedAt: 1,
  decidedAt: 2,
  decidedBy: 'mgr',
  totalMinutes: 0,
  entryCount: 0,
  createdAt: 1,
  updatedAt: 2,
});

async function seed() {
  const db = getFirestore();
  await db.collection('users').doc('alice').set({
    displayName: 'Alice A.',
    email: 'alice@example.com',
  });
  await db.collection('users').doc('bob').set({
    displayName: 'Bob B.',
    email: 'bob@example.com',
  });

  const entries = [
    // Alice, Tutoring, Mon 2026-07-13, 2h — approved period
    {
      uid: 'alice',
      activityId: 'tut',
      activityName: 'Tutoring',
      start: T('2026-07-13', '14:00'),
      end: T('2026-07-13', '16:00'),
      durationMinutes: 120,
      timeZone: 'America/Chicago',
      dayKey: '2026-07-13',
      periodKey: '2026-07-12',
      source: 'manual',
      note: 'with, comma',
      createdAt: 1,
      updatedAt: 1,
    },
    // Alice, Food Drive, Wed 2026-07-15, 1h — approved period
    {
      uid: 'alice',
      activityId: 'fd',
      activityName: 'Food Drive',
      start: T('2026-07-15', '09:00'),
      end: T('2026-07-15', '10:00'),
      durationMinutes: 60,
      timeZone: 'America/Chicago',
      dayKey: '2026-07-15',
      periodKey: '2026-07-12',
      source: 'clock',
      createdAt: 1,
      updatedAt: 1,
    },
    // Bob, Tutoring, Tue 2026-07-14, 30m — approved period
    {
      uid: 'bob',
      activityId: 'tut',
      activityName: 'Tutoring',
      start: T('2026-07-14', '18:00'),
      end: T('2026-07-14', '18:30'),
      durationMinutes: 30,
      timeZone: 'America/Chicago',
      dayKey: '2026-07-14',
      periodKey: '2026-07-12',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1,
    },
    // Alice, running session (must be excluded everywhere)
    {
      uid: 'alice',
      activityId: 'tut',
      activityName: 'Tutoring',
      start: T('2026-07-15', '20:00'),
      end: null,
      timeZone: 'America/Chicago',
      dayKey: '2026-07-15',
      periodKey: '2026-07-12',
      source: 'clock',
      createdAt: 1,
      updatedAt: 1,
    },
    // Bob, NEXT period (2026-07-19), NOT approved — official reports must skip it
    {
      uid: 'bob',
      activityId: 'tut',
      activityName: 'Tutoring',
      start: T('2026-07-20', '18:00'),
      end: T('2026-07-20', '19:00'),
      durationMinutes: 60,
      timeZone: 'America/Chicago',
      dayKey: '2026-07-20',
      periodKey: '2026-07-19',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1,
    },
    // Alice, clipped FIRST period of July (dayKey 07-03 → period 07-01), approved
    {
      uid: 'alice',
      activityId: 'fd',
      activityName: 'Food Drive',
      start: T('2026-07-03', '12:00'),
      end: T('2026-07-03', '12:45'),
      durationMinutes: 45,
      timeZone: 'America/Chicago',
      dayKey: '2026-07-03',
      periodKey: '2026-07-01',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  for (const e of entries) await db.collection('timeEntries').add(e);

  // Approved sheets: alice + bob for 07-12 week; alice for the clipped 07-01 week.
  await db.collection('timesheets').doc('alice_2026-07-12')
    .set(approvedSheet('alice', '2026-07-12', '2026-07-18'));
  await db.collection('timesheets').doc('bob_2026-07-12')
    .set(approvedSheet('bob', '2026-07-12', '2026-07-18'));
  await db.collection('timesheets').doc('alice_2026-07-01')
    .set(approvedSheet('alice', '2026-07-01', '2026-07-04'));
}

beforeEach(async () => {
  const db = getFirestore();
  for (const c of ['timeEntries', 'users', 'timesheets']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await seed();
});

describe('computeTotals — approved timesheets only by default', () => {
  it('rolls up approved periods, excluding the running session and unapproved weeks', async () => {
    const t = await computeTotals({ fromKey: '2026-07-01', toKey: '2026-07-31' });
    expect(t.totalMinutes).toBe(255); // 120 + 60 + 30 + 45; NOT bob's unapproved 60
    expect(t.byActivity[0]).toEqual({ activityId: 'tut', activityName: 'Tutoring', minutes: 150 });
    expect(t.byPerson.find((p) => p.uid === 'alice')?.minutes).toBe(225);
    expect(t.byPerson.find((p) => p.uid === 'bob')?.minutes).toBe(30);
  });

  it('includeUnapproved adds the pending hours (unofficial view)', async () => {
    const t = await computeTotals({
      fromKey: '2026-07-01',
      toKey: '2026-07-31',
      includeUnapproved: true,
    });
    expect(t.totalMinutes).toBe(315); // + bob's unapproved 60
  });

  it('counts an entry in a CLIPPED first period only via that period’s own approval', async () => {
    const t = await computeTotals({ fromKey: '2026-07-01', toKey: '2026-07-04' });
    expect(t.totalMinutes).toBe(45);
    // Remove the clipped period's approval → nothing official remains in range.
    await getFirestore().collection('timesheets').doc('alice_2026-07-01').delete();
    const t2 = await computeTotals({ fromKey: '2026-07-01', toKey: '2026-07-04' });
    expect(t2.totalMinutes).toBe(0);
  });

  it('filters by person', async () => {
    const t = await computeTotals({ uid: 'bob', fromKey: '2026-07-01', toKey: '2026-07-31' });
    expect(t.totalMinutes).toBe(30);
  });

  it('filters by activity and date window', async () => {
    const t = await computeTotals({
      activityId: 'tut',
      fromKey: '2026-07-14',
      toKey: '2026-07-14',
    });
    expect(t.totalMinutes).toBe(30); // only Bob's tutoring that day
  });
});

describe('buildCsv', () => {
  it('emits header + one row per approved closed entry, with real emails', async () => {
    const csv = await buildCsv({ fromKey: '2026-07-12', toKey: '2026-07-18' });
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Person,Email,Activity,Date,Start,End');
    expect(lines).toHaveLength(4); // header + 3 approved closed entries in range
    // Alice's tutoring 14:00–16:00 UTC = 09:00–11:00 America/Chicago (CDT)
    const aliceTut = lines.find((l) => l.includes('Alice A.') && l.includes('Tutoring'));
    expect(aliceTut).toContain('alice@example.com');
    expect(aliceTut).toContain('09:00,11:00');
    expect(aliceTut).toContain('"with, comma"'); // comma-safe quoting
    expect(csv).not.toContain('20:00'); // running session excluded
  });

  it('excludes unapproved weeks by default; includes them when asked', async () => {
    const official = await buildCsv({ fromKey: '2026-07-01', toKey: '2026-07-31' });
    expect(official).not.toContain('2026-07-20');
    const unofficial = await buildCsv({
      fromKey: '2026-07-01',
      toKey: '2026-07-31',
      includeUnapproved: true,
    });
    expect(unofficial).toContain('2026-07-20');
  });
});
