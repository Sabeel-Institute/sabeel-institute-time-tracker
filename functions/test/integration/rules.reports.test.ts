import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { COLLECTIONS, EMULATOR_PROJECT_ID, RULES_VERSION } from '@sabeel/shared';

/**
 * Two records only the server writes, held there by firestore.rules:
 *
 *  - `reports`: a report names who sent it and what they said about someone,
 *    and is for the administrators, who read it in their email. No client
 *    reads or writes one: not its author, not an admin.
 *  - `rulesVersion` / `rulesAcceptedAt` on a profile: accepting the
 *    institute's rules is recorded by the acceptRules callable alone, so a
 *    person cannot mark themselves as having agreed.
 *
 * Every denial here was shown red with its rule opened (`/reports` to
 * `if true`; the two fields added to the self-update allow-list), and each
 * profile denial has its control beside it: the same person, the same write
 * path, a field they may change, succeeding.
 */
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is unset — run via npm run test:emulator');
  const [h, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: {
      host: h,
      port: Number(port),
      rules: readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

const profile = (email: string, extra: Record<string, unknown> = {}) => ({
  displayName: email.split('@')[0],
  email,
  photoURL: null,
  status: 'active',
  role: 'member',
  admin: false,
  activeEntryId: null,
  approverUid: null,
  createdAt: 1,
  ...extra,
});

const REPORT = {
  app: 'Sabeel Time Tracker',
  uid: 'alice',
  displayName: 'alice',
  email: 'alice@oursabeel.com',
  role: 'member',
  text: 'Someone changed my note.',
  createdAt: 1,
  mail: { status: 'sent', messageId: 'm1' },
};

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await Promise.all([
      db.doc('users/alice').set(profile('alice@oursabeel.com')),
      db.doc('users/boss').set(profile('boss@oursabeel.com', { role: 'manager', admin: true })),
      db.doc(`${COLLECTIONS.reports}/r1`).set(REPORT),
    ]);
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const as = (uid: string, claims: Record<string, unknown>) =>
  testEnv.authenticatedContext(uid, { ...claims, email: `${uid}@oursabeel.com` }).firestore();
const member = { status: 'active', role: 'member', admin: false };
const admin = { status: 'active', role: 'manager', admin: true };

describe('reports: no client reads or writes one', () => {
  it('its author cannot read it, find it, or change it', async () => {
    const db = as('alice', member);
    await assertFails(getDoc(doc(db, `${COLLECTIONS.reports}/r1`)));
    await assertFails(getDocs(query(collection(db, COLLECTIONS.reports), where('uid', '==', 'alice'))));
    await assertFails(updateDoc(doc(db, `${COLLECTIONS.reports}/r1`), { text: 'changed' }));
    await assertFails(deleteDoc(doc(db, `${COLLECTIONS.reports}/r1`)));
  });

  it('nobody writes one from a client, not even their own', async () => {
    await assertFails(setDoc(doc(as('alice', member), `${COLLECTIONS.reports}/mine`), { ...REPORT }));
    await assertFails(setDoc(doc(as('boss', admin), `${COLLECTIONS.reports}/forged`), { ...REPORT, uid: 'boss' }));
  });

  it('an administrator cannot read or list them in the app either', async () => {
    const db = as('boss', admin);
    await assertFails(getDoc(doc(db, `${COLLECTIONS.reports}/r1`)));
    await assertFails(getDocs(collection(db, COLLECTIONS.reports)));
  });

  it('nor can anyone signed out', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `${COLLECTIONS.reports}/r1`)));
    await assertFails(setDoc(doc(db, `${COLLECTIONS.reports}/anon`), REPORT));
  });
});

describe('accepting the rules is the server’s record, not the person’s', () => {
  it('a person cannot mark themselves as having accepted (while their own time zone is theirs to write)', async () => {
    const db = as('alice', member);
    const me = doc(db, 'users/alice');
    await assertFails(updateDoc(me, { rulesVersion: RULES_VERSION }));
    await assertFails(updateDoc(me, { rulesAcceptedAt: Date.now() }));
    await assertFails(updateDoc(me, { rulesVersion: RULES_VERSION, rulesAcceptedAt: Date.now() }));
    // The control: the same person, the same update path, a field they own.
    await assertSucceeds(updateDoc(me, { timeZone: 'America/Chicago' }));
  });

  it('nor can an administrator write it for someone else', async () => {
    const db = as('boss', admin);
    await assertFails(updateDoc(doc(db, 'users/alice'), { rulesVersion: RULES_VERSION, rulesAcceptedAt: Date.now() }));
    // The control: the one field an admin may set on someone else's profile.
    await assertSucceeds(updateDoc(doc(db, 'users/alice'), { approverUid: 'boss' }));
  });
});
