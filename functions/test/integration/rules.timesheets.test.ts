// Timesheet lifecycle rules: submit (owner create) → approve/reject (stamped
// approver or admin) → resubmit (owner, after rejection); withdraw = owner
// delete pre-approval; admin delete = reopen. See firestore.rules /timesheets.
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { EMULATOR_PROJECT_ID } from '@sabeel/shared';

let testEnv: RulesTestEnvironment;

const T0 = 1752570000000;
const PERIOD = '2026-07-12'; // a Sunday; full period 07-12..07-18
const TS_ID = `alice_${PERIOD}`;

const submitDoc = {
  uid: 'alice',
  periodKey: PERIOD,
  toKey: '2026-07-18',
  status: 'submitted',
  approverUid: 'mgr',
  submittedAt: T0,
  totalMinutes: 60,
  entryCount: 1,
  createdAt: T0,
  updatedAt: T0,
};

const userDoc = (over: Record<string, unknown>) => ({
  displayName: 'X',
  email: 'x@example.com',
  photoURL: null,
  status: 'active',
  role: 'member',
  admin: false,
  activeEntryId: null,
  approverUid: null,
  createdAt: 1,
  ...over,
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
    await setDoc(doc(db, 'users/alice'), userDoc({ displayName: 'Alice', approverUid: 'mgr' }));
    await setDoc(doc(db, 'users/mgr'), userDoc({ displayName: 'Mgr', role: 'manager' }));
    await setDoc(doc(db, 'users/mgr2'), userDoc({ displayName: 'Mgr2', role: 'manager' }));
    await setDoc(doc(db, 'users/adm'), userDoc({ displayName: 'Adm', admin: true }));
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const alice = () =>
  testEnv.authenticatedContext('alice', { status: 'active', role: 'member' });
const mgr = () => testEnv.authenticatedContext('mgr', { status: 'active', role: 'manager' });
const mgr2 = () => testEnv.authenticatedContext('mgr2', { status: 'active', role: 'manager' });
const adm = () =>
  testEnv.authenticatedContext('adm', { status: 'active', role: 'member', admin: true });
const bob = () => testEnv.authenticatedContext('bob', { status: 'active', role: 'member' });

const seed = (over: Record<string, unknown>) =>
  testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `timesheets/${TS_ID}`), { ...submitDoc, ...over });
  });

describe('timesheets — submit', () => {
  it('owner submits with the stamped approver from their profile', async () => {
    await assertSucceeds(setDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), submitDoc));
  });

  it('zero-hour submission is allowed', async () => {
    await assertSucceeds(
      setDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), {
        ...submitDoc,
        totalMinutes: 0,
        entryCount: 0,
      }),
    );
  });

  it('rejects: mismatched doc id, non-canonical periodKey, cross-period toKey', async () => {
    const db = alice().firestore();
    await assertFails(setDoc(doc(db, 'timesheets/alice_2026-07-13'), submitDoc)); // id ≠ uid_periodKey
    await assertFails(
      setDoc(doc(db, 'timesheets/alice_2026-07-15'), {
        ...submitDoc,
        periodKey: '2026-07-15', // Wednesday — not a canonical period start
        toKey: '2026-07-18',
      }),
    );
    await assertFails(
      setDoc(doc(db, `timesheets/${TS_ID}`), { ...submitDoc, toKey: '2026-07-19' }), // next period
    );
  });

  it('rejects a stamp that is not the current profile approver', async () => {
    await assertFails(
      setDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), {
        ...submitDoc,
        approverUid: 'mgr2',
      }),
    );
  });

  it('cannot submit with no approver set (profile approverUid null)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), userDoc({ displayName: 'Alice' }));
    });
    await assertFails(setDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), submitDoc));
  });

  it('manager self-stamps when they are their own approver (M5 policy)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'users/mgr'),
        userDoc({ displayName: 'Mgr', role: 'manager', approverUid: 'mgr' }),
      );
    });
    await assertSucceeds(
      setDoc(doc(mgr().firestore(), `timesheets/mgr_${PERIOD}`), {
        ...submitDoc,
        uid: 'mgr',
        approverUid: 'mgr',
      }),
    );
  });

  it('admin self-stamps (top of chain)', async () => {
    await assertSucceeds(
      setDoc(doc(adm().firestore(), `timesheets/adm_${PERIOD}`), {
        ...submitDoc,
        uid: 'adm',
        approverUid: 'adm',
      }),
    );
  });

  it('cannot submit a future period or someone else’s, or create pre-decided', async () => {
    // 2027-07-11 is a Sunday a year out — canonical but not started.
    await assertFails(
      setDoc(doc(alice().firestore(), 'timesheets/alice_2027-07-11'), {
        ...submitDoc,
        periodKey: '2027-07-11',
        toKey: '2027-07-17',
      }),
    );
    await assertFails(
      setDoc(doc(mgr().firestore(), `timesheets/${TS_ID}`), submitDoc), // not the owner
    );
    await assertFails(
      setDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), {
        ...submitDoc,
        status: 'approved',
      }),
    );
    await assertFails(
      setDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), {
        ...submitDoc,
        decidedAt: T0,
        decidedBy: 'alice',
      }),
    );
  });
});

describe('timesheets — decide', () => {
  beforeEach(() => seed({}));

  const approvePatch = {
    status: 'approved',
    decidedAt: T0 + 1,
    decidedBy: 'mgr',
    updatedAt: T0 + 1,
  };

  it('stamped approver approves; rejects require a reason', async () => {
    await assertSucceeds(updateDoc(doc(mgr().firestore(), `timesheets/${TS_ID}`), approvePatch));
  });

  it('stamped approver rejects with reason ✓, without ✗', async () => {
    await assertFails(
      updateDoc(doc(mgr().firestore(), `timesheets/${TS_ID}`), {
        ...approvePatch,
        status: 'rejected',
      }),
    );
    await assertSucceeds(
      updateDoc(doc(mgr().firestore(), `timesheets/${TS_ID}`), {
        ...approvePatch,
        status: 'rejected',
        rejectReason: 'Wrong activity on Tuesday.',
      }),
    );
  });

  it('non-stamped manager cannot decide; admin can', async () => {
    await assertFails(
      updateDoc(doc(mgr2().firestore(), `timesheets/${TS_ID}`), {
        ...approvePatch,
        decidedBy: 'mgr2',
      }),
    );
    await assertSucceeds(
      updateDoc(doc(adm().firestore(), `timesheets/${TS_ID}`), {
        ...approvePatch,
        decidedBy: 'adm',
      }),
    );
  });

  it('a manager approves their own sheet when self-stamped (M5 policy)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `timesheets/mgr_${PERIOD}`), {
        ...submitDoc,
        uid: 'mgr',
        approverUid: 'mgr',
      });
    });
    await assertSucceeds(
      updateDoc(doc(mgr().firestore(), `timesheets/mgr_${PERIOD}`), approvePatch),
    );
  });

  // A stamp is written once and never revisited, so the role must be re-checked
  // at decide time — otherwise losing the role leaves the authority behind.
  it('a stamped approver who has since been demoted or disabled cannot decide', async () => {
    const demoted = testEnv.authenticatedContext('mgr', { status: 'active', role: 'member' });
    await assertFails(updateDoc(doc(demoted.firestore(), `timesheets/${TS_ID}`), approvePatch));

    const disabled = testEnv.authenticatedContext('mgr', { status: 'disabled', role: 'manager' });
    await assertFails(updateDoc(doc(disabled.firestore(), `timesheets/${TS_ID}`), approvePatch));

    // …but an admin who is not a manager still decides anything.
    await assertSucceeds(
      updateDoc(doc(adm().firestore(), `timesheets/${TS_ID}`), {
        ...approvePatch,
        decidedBy: 'adm',
      }),
    );
  });

  it('an owner who is NOT the stamped approver cannot decide their own sheet', async () => {
    await assertFails(
      updateDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), {
        ...approvePatch,
        decidedBy: 'alice',
      }),
    );
  });

  it('decidedBy must be the caller; uid/periodKey immutable; no double-decide', async () => {
    await assertFails(
      updateDoc(doc(mgr().firestore(), `timesheets/${TS_ID}`), {
        ...approvePatch,
        decidedBy: 'someone-else',
      }),
    );
    await assertFails(
      updateDoc(doc(mgr().firestore(), `timesheets/${TS_ID}`), {
        ...approvePatch,
        periodKey: '2026-07-19',
      }),
    );
    await seed({ status: 'approved', decidedAt: T0, decidedBy: 'mgr' });
    await assertFails(
      updateDoc(doc(mgr().firestore(), `timesheets/${TS_ID}`), {
        status: 'rejected',
        decidedAt: T0 + 2,
        decidedBy: 'mgr',
        rejectReason: 'changed my mind',
        updatedAt: T0 + 2,
      }),
    );
  });
});

describe('timesheets — resubmit after rejection', () => {
  beforeEach(() => seed({ status: 'rejected', decidedAt: T0, decidedBy: 'mgr', rejectReason: 'fix' }));

  const resubmitPatch = {
    status: 'submitted',
    approverUid: 'mgr',
    submittedAt: T0 + 5,
    totalMinutes: 90,
    entryCount: 2,
    updatedAt: T0 + 5,
    decidedAt: deleteField(),
    decidedBy: deleteField(),
    rejectReason: deleteField(),
  };

  it('owner resubmits, clearing the decision fields', async () => {
    await assertSucceeds(
      updateDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), resubmitPatch),
    );
  });

  it('resubmit must clear the decision fields', async () => {
    await assertFails(
      updateDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), {
        ...resubmitPatch,
        decidedAt: T0,
        decidedBy: 'mgr',
      }),
    );
  });

  it('owner cannot flip rejected straight to approved; approver cannot resubmit', async () => {
    await assertFails(
      updateDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), {
        ...resubmitPatch,
        status: 'approved',
      }),
    );
    await assertFails(updateDoc(doc(mgr().firestore(), `timesheets/${TS_ID}`), resubmitPatch));
  });

  it('resubmit re-stamps from the CURRENT profile approver', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'users/alice'),
        userDoc({ displayName: 'Alice', approverUid: 'mgr2' }),
      );
    });
    await assertFails(
      updateDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), resubmitPatch), // stale mgr stamp
    );
    await assertSucceeds(
      updateDoc(doc(alice().firestore(), `timesheets/${TS_ID}`), {
        ...resubmitPatch,
        approverUid: 'mgr2',
      }),
    );
  });
});

describe('timesheets — withdraw and reopen (deletes)', () => {
  it('owner withdraws a submitted sheet; a rejected one too', async () => {
    await seed({});
    await assertSucceeds(deleteDoc(doc(alice().firestore(), `timesheets/${TS_ID}`)));
    await seed({ status: 'rejected', decidedAt: T0, decidedBy: 'mgr', rejectReason: 'fix' });
    await assertSucceeds(deleteDoc(doc(alice().firestore(), `timesheets/${TS_ID}`)));
  });

  it('owner cannot delete an approved sheet; admin reopens it; approver cannot', async () => {
    await seed({ status: 'approved', decidedAt: T0, decidedBy: 'mgr' });
    await assertFails(deleteDoc(doc(alice().firestore(), `timesheets/${TS_ID}`)));
    await assertFails(deleteDoc(doc(mgr().firestore(), `timesheets/${TS_ID}`)));
    await assertSucceeds(deleteDoc(doc(adm().firestore(), `timesheets/${TS_ID}`)));
  });
});

describe('timesheets — reads', () => {
  beforeEach(() => seed({}));

  it('owner, stamped approver, any manager, and admin read; other members cannot', async () => {
    await assertSucceeds(getDoc(doc(alice().firestore(), `timesheets/${TS_ID}`)));
    await assertSucceeds(getDoc(doc(mgr().firestore(), `timesheets/${TS_ID}`)));
    await assertSucceeds(getDoc(doc(mgr2().firestore(), `timesheets/${TS_ID}`)));
    await assertSucceeds(getDoc(doc(adm().firestore(), `timesheets/${TS_ID}`)));
    await assertFails(getDoc(doc(bob().firestore(), `timesheets/${TS_ID}`)));
  });

  it('listener on one’s own not-yet-submitted (missing) sheet is allowed; on others’ not', async () => {
    await assertSucceeds(getDoc(doc(alice().firestore(), 'timesheets/alice_2026-07-19')));
    await assertFails(getDoc(doc(bob().firestore(), 'timesheets/alice_2026-07-19')));
  });
});
