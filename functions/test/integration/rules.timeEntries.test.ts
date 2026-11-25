import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { EMULATOR_PROJECT_ID } from '@sabeel/shared';

let testEnv: RulesTestEnvironment;

// 2026-07-15T09:00Z — 04:00 in America/Chicago, so it really is the local day
// every fixture below labels it. Not arbitrary: rules now check that an entry's
// dayKey can actually correspond to its `start`, and the previous value was a
// year off from the dayKeys it was paired with.
const T0 = Date.UTC(2026, 6, 15, 9);
// dayKey 2026-07-15 is a Wednesday; its Sun–Sat month-clipped period starts 07-12.
const PERIOD = '2026-07-12';
const closedEntry = {
  uid: 'alice',
  activityId: 'act1',
  activityName: 'Tutoring',
  start: T0,
  end: T0 + 60 * 60000,
  durationMinutes: 60,
  timeZone: 'America/Chicago',
  dayKey: '2026-07-15',
  periodKey: PERIOD,
  source: 'manual',
  createdAt: T0,
  updatedAt: T0,
};
const runningEntry = {
  uid: 'alice',
  activityId: 'act1',
  activityName: 'Tutoring',
  start: T0,
  end: null,
  timeZone: 'America/Chicago',
  dayKey: '2026-07-15',
  periodKey: PERIOD,
  source: 'clock',
  createdAt: T0,
  updatedAt: T0,
};
// A submitted/approved/rejected timesheet covering PERIOD for alice.
const aliceTimesheet = (status: 'submitted' | 'approved' | 'rejected') => ({
  uid: 'alice',
  periodKey: PERIOD,
  toKey: '2026-07-18',
  status,
  approverUid: 'mgr',
  submittedAt: T0,
  totalMinutes: 60,
  entryCount: 1,
  createdAt: T0,
  updatedAt: T0,
  ...(status === 'rejected' ? { decidedAt: T0, decidedBy: 'mgr', rejectReason: 'fix it' } : {}),
  ...(status === 'approved' ? { decidedAt: T0, decidedBy: 'mgr' } : {}),
});

const aliceUserDoc = () => ({
  displayName: 'Alice',
  email: 'alice@example.com',
  photoURL: null,
  status: 'active',
  role: 'member',
  admin: false,
  approverUid: 'mgr',
  createdAt: 1,
});

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  // No fallback on purpose. This suite only ever runs under
  // `firebase emulators:exec`, which always exports this (firebase-tools
  // lib/emulator/env.js). A default would be dead code that springs to life at
  // exactly the wrong moment: with the var unset it would connect to whatever
  // sits on the old shared port — possibly a SIBLING REPO's Firestore — and the
  // suite would read, write and pass against the wrong database.
  if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is unset — run via npm run test:emulator');
  const fs = host.split(':');
  testEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: {
      host: fs[0],
      port: Number(fs[1]),
      rules: readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), aliceUserDoc());
    // Entry creates now check referential integrity, so the referenced activity
    // and the entry's owner must exist.
    await setDoc(doc(db, 'users/mgr'), {
      ...aliceUserDoc(),
      displayName: 'Mgr',
      role: 'manager',
    });
    await setDoc(doc(db, 'users/adm'), { ...aliceUserDoc(), admin: true });
    await setDoc(doc(db, 'activities/act1'), {
      name: 'Tutoring',
      status: 'active',
      createdAt: T0,
      createdBy: 'mgr',
    });
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const alice = () =>
  testEnv.authenticatedContext('alice', { status: 'active', role: 'member' });
const bob = () => testEnv.authenticatedContext('bob', { status: 'active', role: 'member' });
const manager = () =>
  testEnv.authenticatedContext('mgr', { status: 'active', role: 'manager' });
// A second manager who is NOT the stamped approver of alice's timesheets.
const manager2 = () =>
  testEnv.authenticatedContext('mgr2', { status: 'active', role: 'manager' });
const admin = () =>
  testEnv.authenticatedContext('adm', { status: 'active', role: 'member', admin: true });

const seedTimesheet = (status: 'submitted' | 'approved' | 'rejected') =>
  testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `timesheets/alice_${PERIOD}`), aliceTimesheet(status));
  });

const RUN = 'timeEntries/running_alice';
// The finished entry a clock-out writes: the session, ended.
const finishedFrom = (session: typeof runningEntry, minutes = 30) => ({
  ...session, end: session.start + minutes * 60000, durationMinutes: minutes, updatedAt: session.start + minutes * 60000,
});
async function seedSession(session: object = runningEntry) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), RUN), session);
  });
}
const finishedId = (start: number) => `timeEntries/clock_alice_${start}`;
function clockOutBatch(db: ReturnType<ReturnType<typeof alice>['firestore']>, finished: { start: number } & Record<string, unknown>, id = finishedId(finished.start)) {
  const batch = writeBatch(db);
  batch.set(doc(db, id), finished);
  batch.delete(doc(db, RUN));
  return batch;
}

describe('timeEntries — clock in and out', () => {
  it('clock-in creates the session at the fixed running id, and nowhere else', async () => {
    const db = alice().firestore();
    await assertFails(setDoc(doc(db, 'timeEntries/e1'), runningEntry));
    await assertFails(setDoc(doc(db, 'timeEntries/running_bob'), runningEntry));
    await assertSucceeds(setDoc(doc(db, RUN), runningEntry));
  });

  it('a second clock-in cannot replace the session in progress', async () => {
    await seedSession();
    await assertFails(setDoc(doc(alice().firestore(), RUN), { ...runningEntry, start: T0 + 60000, createdAt: T0 + 60000 }));
  });

  it('only a session in progress has the running id, and it ends only by clocking out', async () => {
    const db = alice().firestore();
    await assertFails(setDoc(doc(db, RUN), closedEntry));
    await seedSession();
    await assertFails(updateDoc(doc(db, RUN), { end: T0 + 60000, durationMinutes: 1, updatedAt: T0 + 60000 }));
    await assertFails(updateDoc(doc(db, RUN), { start: T0 - 60000 }));
    await assertSucceeds(updateDoc(doc(db, RUN), { note: 'Setting up', updatedAt: T0 + 1 }));
  });

  it('clock-out writes the finished session and removes it in one write', async () => {
    await seedSession();
    const db = alice().firestore();
    // The finished entry without ending the session, or under another id.
    await assertFails(setDoc(doc(db, finishedId(T0)), finishedFrom(runningEntry)));
    await assertFails(clockOutBatch(db, finishedFrom(runningEntry), 'timeEntries/clock_alice_other').commit());
    // Ending the session without its finished entry: no discarding hours.
    await assertFails(deleteDoc(doc(db, RUN)));
    const disguised = writeBatch(db);
    disguised.set(doc(db, 'timeEntries/manual1'), finishedFrom(runningEntry));
    disguised.delete(doc(db, RUN));
    await assertFails(disguised.commit());
    await assertFails(deleteDoc(doc(bob().firestore(), RUN)));
    await assertSucceeds(clockOutBatch(db, finishedFrom(runningEntry)).commit());
  });

  it('a stale clock-out cannot end a newer session or duplicate a finished one', async () => {
    const db = alice().firestore();
    // Queued offline for the session that started at T0; another device has
    // since clocked out and in again.
    await seedSession({ ...runningEntry, start: T0 + 3600000, createdAt: T0 + 3600000 });
    await assertFails(clockOutBatch(db, finishedFrom(runningEntry)).commit());
    // The same clock-out again once it has gone through: refused, one entry.
    await seedSession();
    await assertSucceeds(clockOutBatch(db, finishedFrom(runningEntry)).commit());
    await assertFails(clockOutBatch(db, finishedFrom(runningEntry, 45)).commit());
    expect((await getDoc(doc(db, finishedId(T0)))).data()?.durationMinutes).toBe(30);
  });

  it('a clock-out cannot change the session’s day, place or activity on the way', async () => {
    await seedSession();
    const db = alice().firestore();
    await assertFails(clockOutBatch(db, { ...finishedFrom(runningEntry), timeZone: 'UTC' }).commit());
    await assertFails(clockOutBatch(db, { ...finishedFrom(runningEntry), activityId: 'other' }).commit());
    await assertFails(clockOutBatch(db, { ...finishedFrom(runningEntry), source: 'manual' }).commit());
  });

  it('only its owner can find out whether a session is in progress', async () => {
    await assertSucceeds(getDoc(doc(alice().firestore(), RUN)));
    await assertFails(getDoc(doc(bob().firestore(), RUN)));
    await seedSession();
    await assertFails(getDoc(doc(bob().firestore(), RUN)));
    await assertSucceeds(getDoc(doc(manager().firestore(), RUN)));
  });
});

describe('timeEntries — manual entries and validation', () => {
  it('owner creates a valid closed manual entry', async () => {
    await assertSucceeds(setDoc(doc(alice().firestore(), 'timeEntries/m1'), closedEntry));
  });

  it('rejects entries for someone else, backwards times, over-cap, bad shape', async () => {
    const db = alice().firestore();
    await assertFails(setDoc(doc(db, 'timeEntries/m1'), { ...closedEntry, uid: 'bob' }));
    await assertFails(
      setDoc(doc(db, 'timeEntries/m2'), { ...closedEntry, end: T0 - 1, durationMinutes: 1 }),
    );
    await assertFails(
      setDoc(doc(db, 'timeEntries/m3'), {
        ...closedEntry,
        end: T0 + 25 * 3600000,
        durationMinutes: 25 * 60,
      }),
    );
    await assertFails(setDoc(doc(db, 'timeEntries/m4'), { ...closedEntry, dayKey: 'nope' }));
    // running entry must not carry durationMinutes
    await assertFails(
      setDoc(doc(db, 'timeEntries/m5'), { ...runningEntry, durationMinutes: 10 }),
    );
  });

  it('M2: durationMinutes cannot exceed the span (inflation blocked)', async () => {
    const db = alice().firestore();
    // Times 1 minute apart but claiming 24h — the classic inflation attempt.
    await assertFails(
      setDoc(doc(db, 'timeEntries/inf'), {
        ...closedEntry,
        end: T0 + 60000,
        durationMinutes: 24 * 60,
      }),
    );
  });

  it('M2: an honest rounded duration (90s → 2) is accepted (the +1 tolerance)', async () => {
    const db = alice().firestore();
    await assertSucceeds(
      setDoc(doc(db, 'timeEntries/round'), {
        ...closedEntry,
        end: T0 + 90000,
        durationMinutes: 2,
      }),
    );
  });
});

describe('timeEntries — reads, corrections, deletes', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'timeEntries/e1'), closedEntry);
    });
  });

  it('owner, manager, and admin (even non-manager) read; other members cannot', async () => {
    await assertSucceeds(getDoc(doc(alice().firestore(), 'timeEntries/e1')));
    await assertSucceeds(getDoc(doc(manager().firestore(), 'timeEntries/e1')));
    // Admins may decide any submitted sheet, so they must be able to read the
    // entries under review — caught in prod by Sentry (permission-denied on
    // useEntriesRange for an admin-without-manager-role).
    await assertSucceeds(getDoc(doc(admin().firestore(), 'timeEntries/e1')));
    await assertFails(getDoc(doc(bob().firestore(), 'timeEntries/e1')));
  });

  it('reading a nonexistent entry is allowed (optimistic clock-in listener race)', async () => {
    await assertSucceeds(getDoc(doc(alice().firestore(), 'timeEntries/never-created')));
  });

  it('manager corrects a closed entry; ownership immutable', async () => {
    await assertSucceeds(
      updateDoc(doc(manager().firestore(), 'timeEntries/e1'), {
        durationMinutes: 45,
        end: T0 + 45 * 60000,
        lastEditedBy: 'mgr',
      }),
    );
    await assertFails(
      updateDoc(doc(manager().firestore(), 'timeEntries/e1'), { uid: 'mgr' }),
    );
  });

  it('manager cannot touch a session in progress', async () => {
    await seedSession();
    await assertFails(updateDoc(doc(manager().firestore(), RUN), { note: 'x', updatedAt: T0, lastEditedBy: 'mgr' }));
  });

  it('owner and manager delete closed entries; others cannot', async () => {
    await assertFails(deleteDoc(doc(bob().firestore(), 'timeEntries/e1')));
    await assertSucceeds(deleteDoc(doc(manager().firestore(), 'timeEntries/e1')));
  });
});

describe('timeEntries — canonical periodKey guard (spoof-proof)', () => {
  it('accepts only periodKeyFor(dayKey); rejects spoofs and omissions', async () => {
    const db = alice().firestore();
    await assertSucceeds(setDoc(doc(db, 'timeEntries/p1'), closedEntry)); // 07-15 → 07-12
    await assertFails(
      setDoc(doc(db, 'timeEntries/p2'), { ...closedEntry, periodKey: '2026-07-15' }), // dayKey itself
    );
    await assertFails(
      setDoc(doc(db, 'timeEntries/p3'), { ...closedEntry, periodKey: '2026-07-05' }), // wrong week
    );
    const { periodKey: _omit, ...noPeriod } = closedEntry;
    await assertFails(setDoc(doc(db, 'timeEntries/p4'), noPeriod));
  });

  /** An entry on `dayKey` at 09:00Z — the instant has to match the day claimed. */
  const onDay = (dayKey: string, periodKey: string) => {
    const [y, m, d] = dayKey.split('-').map(Number);
    const start = Date.UTC(y, m - 1, d, 9);
    return { ...closedEntry, start, end: start + 60 * 60000, dayKey, periodKey };
  };

  it('month-clipped day: dayKey 2026-07-04 (Sat) must carry periodKey 2026-07-01', async () => {
    const db = alice().firestore();
    const clipped = onDay('2026-07-04', '2026-07-01');
    await assertSucceeds(setDoc(doc(db, 'timeEntries/c1'), clipped));
    await assertFails(
      setDoc(doc(db, 'timeEntries/c2'), { ...clipped, periodKey: '2026-06-28' }), // unclipped Sunday
    );
  });

  /**
   * The dayKeyPlausible window is the only timezone reasoning in the rules, and
   * every other fixture sits comfortably inside it — so the 14h/36h constants
   * could be any other pair and the suite would stay green. These pin both
   * edges: each `assertSucceeds` is one millisecond from an `assertFails`, so
   * narrowing OR widening either bound breaks exactly one of them.
   *
   * The numbers are not arbitrary: real UTC offsets run [-12h, +14h], so the
   * instant behind local day D lies in [D_utc - 14h, D_utc + 36h).
   */
  describe('dayKey plausibility window (the ±offset bound)', () => {
    const DAY = '2026-07-15';
    const dayMs = Date.UTC(2026, 6, 15);
    const HOUR = 3600000;
    const at = (start: number) => ({
      ...closedEntry,
      start,
      end: start + 60 * 60000,
      dayKey: DAY,
      periodKey: PERIOD,
    });

    it('earliest legal instant: exactly 14h before UTC midnight (a UTC+14 zone)', async () => {
      const db = alice().firestore();
      // 2026-07-14T10:00Z is already the 15th in Pacific/Kiritimati (UTC+14).
      await assertSucceeds(setDoc(doc(db, 'timeEntries/w1'), at(dayMs - 14 * HOUR)));
      await assertFails(setDoc(doc(db, 'timeEntries/w2'), at(dayMs - 14 * HOUR - 1)));
    });

    it('latest legal instant: just under 36h after UTC midnight (a UTC-12 zone)', async () => {
      const db = alice().firestore();
      // 2026-07-16T11:59:59.999Z is still the 15th at UTC-12.
      await assertSucceeds(setDoc(doc(db, 'timeEntries/w3'), at(dayMs + 36 * HOUR - 1)));
      await assertFails(setDoc(doc(db, 'timeEntries/w4'), at(dayMs + 36 * HOUR)));
    });

    it('a dayKey a whole day off its instant is refused', async () => {
      // The gross mismatch the window exists for: times printed on the entry
      // would contradict the day a report files it under.
      await assertFails(
        setDoc(doc(alice().firestore(), 'timeEntries/w5'), at(dayMs + 4 * 24 * HOUR)),
      );
    });
  });

  it('a Sunday and a 1st-of-month are their own periodKey (pins dowSun0 anchoring)', async () => {
    const db = alice().firestore();
    await assertSucceeds(
      setDoc(doc(db, 'timeEntries/s1'), onDay('2026-07-12', '2026-07-12')),
    );
    await assertSucceeds(
      setDoc(doc(db, 'timeEntries/s2'), onDay('2026-07-01', '2026-07-01')),
    );
  });
});

describe('timeEntries — create on behalf (draft period)', () => {
  it('manager creates a CLOSED entry for alice with lastEditedBy ✓; without ✗; running ✗', async () => {
    const db = manager().firestore();
    await assertSucceeds(
      setDoc(doc(db, 'timeEntries/b1'), { ...closedEntry, lastEditedBy: 'mgr' }),
    );
    await assertFails(setDoc(doc(db, 'timeEntries/b2'), closedEntry)); // unflagged
    await assertFails(
      setDoc(doc(db, 'timeEntries/b3'), { ...runningEntry, lastEditedBy: 'mgr' }), // running
    );
  });

  it('a plain member cannot create entries for someone else', async () => {
    await assertFails(
      setDoc(doc(bob().firestore(), 'timeEntries/b4'), { ...closedEntry, lastEditedBy: 'bob' }),
    );
  });
});

describe('timeEntries — submitted period lock', () => {
  beforeEach(async () => {
    await seedTimesheet('submitted');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'timeEntries/e1'), closedEntry);
    });
  });

  it('owner cannot create, edit, or delete in a submitted period', async () => {
    const db = alice().firestore();
    await assertFails(setDoc(doc(db, 'timeEntries/n1'), closedEntry));
    await assertFails(updateDoc(doc(db, 'timeEntries/e1'), { note: 'oops', updatedAt: T0 }));
    await assertFails(deleteDoc(doc(db, 'timeEntries/e1')));
  });

  it('owner cannot clock in (running create) into a submitted period', async () => {
    await assertFails(setDoc(doc(alice().firestore(), RUN), runningEntry));
  });

  it('stamped approver may edit, add, and delete; a non-stamped manager may not', async () => {
    const mgrDb = manager().firestore();
    await assertSucceeds(
      updateDoc(doc(mgrDb, 'timeEntries/e1'), {
        durationMinutes: 45,
        end: T0 + 45 * 60000,
        lastEditedBy: 'mgr',
        updatedAt: T0,
      }),
    );
    await assertSucceeds(
      setDoc(doc(mgrDb, 'timeEntries/n2'), { ...closedEntry, lastEditedBy: 'mgr' }),
    );
    const mgr2Db = manager2().firestore();
    await assertFails(
      updateDoc(doc(mgr2Db, 'timeEntries/e1'), {
        durationMinutes: 30,
        end: T0 + 30 * 60000,
        lastEditedBy: 'mgr2',
        updatedAt: T0,
      }),
    );
    await assertFails(
      setDoc(doc(mgr2Db, 'timeEntries/n3'), { ...closedEntry, lastEditedBy: 'mgr2' }),
    );
    await assertFails(deleteDoc(doc(mgr2Db, 'timeEntries/e1')));
    await assertSucceeds(deleteDoc(doc(mgrDb, 'timeEntries/e1')));
  });

  it('a demoted stamped approver loses entry edits even with a stale manager token', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users/mgr'), { role: 'member' });
    });
    const renewed = testEnv.authenticatedContext('mgr', { status: 'active', role: 'member' }).firestore();
    const stale = manager().firestore();
    for (const db of [renewed, stale]) {
      await assertFails(updateDoc(doc(db, 'timeEntries/e1'), { note: 'Correction', lastEditedBy: 'mgr' }));
      await assertFails(setDoc(doc(db, 'timeEntries/new-entry'), { ...closedEntry, lastEditedBy: 'mgr' }));
      await assertFails(deleteDoc(doc(db, 'timeEntries/e1')));
    }
  });

  // Self-approval does NOT weaken the freeze: canTouchPeriod excludes the owner
  // outright on a submitted period, before it ever looks at who the approver is.
  // A self-approving manager withdraws (or approves) rather than editing in place,
  // so what gets approved is always what was submitted.
  it('a self-approving manager is still locked out of their OWN submitted period', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, `timesheets/mgr_${PERIOD}`), {
        ...aliceTimesheet('submitted'),
        uid: 'mgr',
        approverUid: 'mgr',
      });
      await setDoc(doc(db, 'timeEntries/m1'), { ...closedEntry, uid: 'mgr' });
    });
    const db = manager().firestore();
    await assertFails(
      updateDoc(doc(db, 'timeEntries/m1'), { note: 'tweak', lastEditedBy: 'mgr', updatedAt: T0 }),
    );
    await assertFails(deleteDoc(doc(db, 'timeEntries/m1')));
    await assertFails(
      setDoc(doc(db, 'timeEntries/m2'), { ...closedEntry, uid: 'mgr', lastEditedBy: 'mgr' }),
    );

    // Control: the identical write succeeds once the period is back to draft, so
    // the failures above are the lock and not a malformed entry.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), `timesheets/mgr_${PERIOD}`));
    });
    await assertSucceeds(
      setDoc(doc(db, 'timeEntries/m2'), { ...closedEntry, uid: 'mgr', lastEditedBy: 'mgr' }),
    );
  });

  it('admin (not stamped) may edit in a submitted period', async () => {
    await assertSucceeds(
      updateDoc(doc(admin().firestore(), 'timeEntries/e1'), {
        durationMinutes: 50,
        end: T0 + 50 * 60000,
        lastEditedBy: 'adm',
        updatedAt: T0,
      }),
    );
  });

  it('CARVE-OUT: owner clocks out of a session in progress despite the submitted period', async () => {
    await seedSession();
    await assertSucceeds(clockOutBatch(alice().firestore(), finishedFrom(runningEntry)).commit());
  });

  it('the carve-out is only a clock-out: other changes on the way are refused', async () => {
    await seedSession();
    await assertFails(clockOutBatch(alice().firestore(), { ...finishedFrom(runningEntry), start: T0 - 60000 }).commit());
  });
});

describe('timeEntries — approved period lock (immutable for everyone)', () => {
  beforeEach(async () => {
    await seedTimesheet('approved');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'timeEntries/e1'), closedEntry);
    });
  });

  it('owner, stamped approver, other manager, and admin are all locked out', async () => {
    const patch = {
      durationMinutes: 99,
      end: T0 + 99 * 60000,
      updatedAt: T0,
    };
    await assertFails(updateDoc(doc(alice().firestore(), 'timeEntries/e1'), patch));
    await assertFails(
      updateDoc(doc(manager().firestore(), 'timeEntries/e1'), { ...patch, lastEditedBy: 'mgr' }),
    );
    await assertFails(
      updateDoc(doc(admin().firestore(), 'timeEntries/e1'), { ...patch, lastEditedBy: 'adm' }),
    );
    await assertFails(setDoc(doc(alice().firestore(), 'timeEntries/n1'), closedEntry));
    await assertFails(
      setDoc(doc(manager().firestore(), 'timeEntries/n2'), { ...closedEntry, lastEditedBy: 'mgr' }),
    );
    await assertFails(deleteDoc(doc(alice().firestore(), 'timeEntries/e1')));
    await assertFails(deleteDoc(doc(manager().firestore(), 'timeEntries/e1')));
    await assertFails(deleteDoc(doc(admin().firestore(), 'timeEntries/e1')));
  });
});

describe('timeEntries — rejected period behaves like draft again', () => {
  it('owner edits freely after rejection', async () => {
    await seedTimesheet('rejected');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'timeEntries/e1'), closedEntry);
    });
    await assertSucceeds(
      updateDoc(doc(alice().firestore(), 'timeEntries/e1'), {
        note: 'fixed per feedback',
        updatedAt: T0,
      }),
    );
    await assertSucceeds(setDoc(doc(alice().firestore(), 'timeEntries/n1'), closedEntry));
  });
});

describe('timeEntries — cross-period moves respect both locks', () => {
  // Moving a day means moving the instant too — dayKey must stay plausible for
  // `start`, or these would fail on validation and never reach the period lock
  // they exist to test.
  const FIVE_DAYS = 5 * 24 * 3600000;
  const nextPeriod = {
    start: T0 + FIVE_DAYS,
    end: T0 + FIVE_DAYS + 60 * 60000,
    dayKey: '2026-07-20',
    periodKey: '2026-07-19',
  };

  it('cannot move an entry from an open period into an approved one (or out of it)', async () => {
    // Approved sheet covers 07-12..07-18; the entry lives in the NEXT (draft) period.
    await seedTimesheet('approved');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'timeEntries/e2'), { ...closedEntry, ...nextPeriod });
    });
    // Move into the approved period: target lock must block it.
    await assertFails(
      updateDoc(doc(alice().firestore(), 'timeEntries/e2'), {
        start: T0,
        end: T0 + 60 * 60000,
        dayKey: '2026-07-15',
        periodKey: PERIOD,
        updatedAt: T0,
      }),
    );
    // And an entry inside the approved period cannot be moved out.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'timeEntries/e3'), closedEntry);
    });
    await assertFails(
      updateDoc(doc(alice().firestore(), 'timeEntries/e3'), { ...nextPeriod, updatedAt: T0 }),
    );

    // Control: the same move between two OPEN periods succeeds, so the failures
    // above are the approved lock and not the new dayKey/start validation.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await deleteDoc(doc(db, `timesheets/alice_${PERIOD}`));
      await setDoc(doc(db, 'timeEntries/e4'), closedEntry);
    });
    await assertSucceeds(
      updateDoc(doc(alice().firestore(), 'timeEntries/e4'), { ...nextPeriod, updatedAt: T0 }),
    );
  });
});

describe('timeEntries — integrity validation', () => {
  it('rejects a dayKey that cannot correspond to the entry start', async () => {
    // start is 2026-07-15; claiming 07-12 puts the bucket three days from the
    // instant, which no real UTC offset can explain.
    await assertFails(
      setDoc(doc(alice().firestore(), 'timeEntries/bad1'), {
        ...closedEntry,
        dayKey: '2026-07-12',
        periodKey: PERIOD,
      }),
    );
  });

  it('accepts the extremes of real UTC offsets around a dayKey', async () => {
    const db = alice().firestore();
    const dayMs = Date.UTC(2026, 6, 15);
    // UTC+14 (Kiritimati): local 2026-07-15 00:00 is 2026-07-14 10:00Z.
    await assertSucceeds(
      setDoc(doc(db, 'timeEntries/edge1'), {
        ...closedEntry,
        start: dayMs - 13 * 3600000,
        end: dayMs - 12 * 3600000,
        timeZone: 'Pacific/Kiritimati',
      }),
    );
    // UTC-12: local 2026-07-15 23:00 is 2026-07-16 11:00Z.
    await assertSucceeds(
      setDoc(doc(db, 'timeEntries/edge2'), {
        ...closedEntry,
        start: dayMs + 35 * 3600000,
        end: dayMs + 35.5 * 3600000,
        durationMinutes: 30,
        timeZone: 'Etc/GMT+12',
      }),
    );
  });

  it('rejects an empty activity name and a blank owner', async () => {
    const db = alice().firestore();
    await assertFails(
      setDoc(doc(db, 'timeEntries/bad2'), { ...closedEntry, activityName: '' }),
    );
    await assertFails(setDoc(doc(db, 'timeEntries/bad3'), { ...closedEntry, uid: '' }));
  });

  it('rejects references to an activity or user that does not exist', async () => {
    await assertFails(
      setDoc(doc(alice().firestore(), 'timeEntries/bad4'), {
        ...closedEntry,
        activityId: 'no-such-activity',
      }),
    );
    // A manager may log on behalf — but not for a uid with no account.
    await assertFails(
      setDoc(doc(manager().firestore(), 'timeEntries/bad5'), {
        ...closedEntry,
        uid: 'ghost-uid',
        lastEditedBy: 'mgr',
      }),
    );
  });
});
