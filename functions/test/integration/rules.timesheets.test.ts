// Timesheet rules: submission and approval are the callables' alone
// (timesheetSubmission/timesheetApproval integration tests); clients reject
// (stamped approver or admin), withdraw (owner, before approval) and reopen
// (admin). See firestore.rules /timesheets.
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

const sheetPath = `timesheets/${TS_ID}`;
const decided = { decidedAt: T0 + 1, decidedBy: 'mgr', updatedAt: T0 + 1 };
const rejection = { ...decided, status: 'rejected', rejectReason: 'Wrong activity on Tuesday.' };

describe('timesheets — submission and approval go through the callables only', () => {
  it('refuses every client submission, including an empty week and an admin self-stamp', async () => {
    await assertFails(setDoc(doc(alice().firestore(), sheetPath), submitDoc));
    await assertFails(setDoc(doc(alice().firestore(), sheetPath), { ...submitDoc, totalMinutes: 0, entryCount: 0 }));
    await assertFails(setDoc(doc(adm().firestore(), 'timesheets/adm_' + PERIOD), { ...submitDoc, uid: 'adm', approverUid: 'adm' }));
  });

  it('refuses a client resubmission of a rejected week', async () => {
    await seed({ status: 'rejected', decidedAt: T0, decidedBy: 'mgr', rejectReason: 'fix' });
    await assertFails(updateDoc(doc(alice().firestore(), sheetPath), {
      status: 'submitted', submittedAt: T0 + 2, updatedAt: T0 + 2,
      decidedAt: deleteField(), decidedBy: deleteField(), rejectReason: deleteField(),
    }));
  });

  it('refuses a client approval, by the stamped approver or an admin', async () => {
    await seed({});
    const approval = { ...decided, status: 'approved' };
    await assertFails(updateDoc(doc(mgr().firestore(), sheetPath), approval));
    await assertFails(updateDoc(doc(adm().firestore(), sheetPath), { ...approval, decidedBy: 'adm' }));
    await assertFails(updateDoc(doc(mgr().firestore(), sheetPath), { ...approval, approvalReview: { limits: {}, flags: [], at: T0 + 1 } }));
  });
});

describe('timesheets — reject', () => {
  beforeEach(() => seed({}));

  it('the stamped approver rejects with a reason, never without one', async () => {
    const reviewing = doc(mgr().firestore(), sheetPath);
    await assertFails(updateDoc(reviewing, { ...decided, status: 'rejected' }));
    await assertFails(updateDoc(reviewing, { ...rejection, rejectReason: '' }));
    await assertSucceeds(updateDoc(reviewing, rejection));
  });

  it('an admin rejects; another manager and the owner cannot', async () => {
    await assertFails(updateDoc(doc(mgr2().firestore(), sheetPath), { ...rejection, decidedBy: 'mgr2' }));
    await assertFails(updateDoc(doc(alice().firestore(), sheetPath), { ...rejection, decidedBy: 'alice' }));
    await assertSucceeds(updateDoc(doc(adm().firestore(), sheetPath), { ...rejection, decidedBy: 'adm' }));
  });

  it('a revoked reviewer cannot reject or reopen through a stale token', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await updateDoc(doc(db, 'users/mgr'), { role: 'member' });
      await updateDoc(doc(db, 'users/adm'), { admin: false });
    });
    await assertFails(updateDoc(doc(mgr().firestore(), sheetPath), rejection));
    const staleAdmin = doc(adm().firestore(), sheetPath);
    await assertFails(updateDoc(staleAdmin, { ...rejection, decidedBy: 'adm' }));
    await assertFails(deleteDoc(staleAdmin));
  });

  it('decidedBy is the caller, nothing else changes, and only a submitted week is rejected', async () => {
    const reviewing = doc(mgr().firestore(), sheetPath);
    await assertFails(updateDoc(reviewing, { ...rejection, decidedBy: 'someone-else' }));
    await assertFails(updateDoc(reviewing, { ...rejection, totalMinutes: 0 }));
    await assertFails(updateDoc(reviewing, { ...rejection, periodKey: '2026-07-19' }));
    await seed({ status: 'approved', decidedAt: T0, decidedBy: 'mgr' });
    await assertFails(updateDoc(reviewing, { ...rejection, decidedAt: T0 + 2, updatedAt: T0 + 2 }));
  });
});

describe('timesheets — withdraw and reopen (deletes)', () => {
  it('owner withdraws a submitted sheet; a rejected one too', async () => {
    await seed({});
    await assertSucceeds(deleteDoc(doc(alice().firestore(), sheetPath)));
    await seed({ status: 'rejected', decidedAt: T0, decidedBy: 'mgr', rejectReason: 'fix' });
    await assertSucceeds(deleteDoc(doc(alice().firestore(), sheetPath)));
  });

  it('owner cannot delete an approved sheet; admin reopens it; approver cannot', async () => {
    await seed({ status: 'approved', decidedAt: T0, decidedBy: 'mgr' });
    await assertFails(deleteDoc(doc(alice().firestore(), sheetPath)));
    await assertFails(deleteDoc(doc(mgr().firestore(), sheetPath)));
    await assertSucceeds(deleteDoc(doc(adm().firestore(), sheetPath)));
  });
});

describe('timesheets — reads', () => {
  beforeEach(() => seed({}));

  it('owner, stamped approver, any manager, and admin read; other members cannot', async () => {
    await assertSucceeds(getDoc(doc(alice().firestore(), sheetPath)));
    await assertSucceeds(getDoc(doc(mgr().firestore(), sheetPath)));
    await assertSucceeds(getDoc(doc(mgr2().firestore(), sheetPath)));
    await assertSucceeds(getDoc(doc(adm().firestore(), sheetPath)));
    await assertFails(getDoc(doc(bob().firestore(), sheetPath)));
  });

  it('listener on one’s own not-yet-submitted (missing) sheet is allowed; on others’ not', async () => {
    await assertSucceeds(getDoc(doc(alice().firestore(), 'timesheets/alice_2026-07-19')));
    await assertFails(getDoc(doc(bob().firestore(), 'timesheets/alice_2026-07-19')));
  });
});
