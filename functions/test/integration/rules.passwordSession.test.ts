import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { EMULATOR_PROJECT_ID, PASSWORD_ACCOUNT_EMAIL } from '@sabeel/shared';

/**
 * The one email-and-password account (PASSWORD_ACCOUNT_EMAIL) is an ordinary
 * member that sees its own hours and nothing else, and the rules hold that
 * whatever its claims say:
 *
 *  - a password session for any OTHER address is signed out, active claims or
 *    not (a second password account an administrator made by mistake, or one
 *    made before the sign-in gate existed);
 *  - a password session is never a manager or an admin, even with those claims.
 *
 * Every denial below must go red when the lock is removed (it was: the two
 * password clauses taken out of isSignedIn/isManager/isAdmin, see the commit).
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

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
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
    await Promise.all([
      db.doc('users/rev').set(profile(PASSWORD_ACCOUNT_EMAIL, { approverUid: 'boss' })),
      db.doc('users/stray').set(profile('stray@oursabeel.com')),
      db.doc('users/alice').set(profile('alice@oursabeel.com')),
      db.doc('users/boss').set(profile('boss@oursabeel.com', { role: 'manager', admin: true })),
      db.doc('timeEntries/rev-1').set({ uid: 'rev', dayKey: '2026-10-14' }),
      db.doc('timeEntries/stray-1').set({ uid: 'stray', dayKey: '2026-10-14' }),
      db.doc('timeEntries/alice-1').set({ uid: 'alice', dayKey: '2026-10-14' }),
    ]);
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const password = (uid: string, email: string, claims: Record<string, unknown>) =>
  testEnv
    .authenticatedContext(uid, { ...claims, email, firebase: { sign_in_provider: 'password', identities: {} } })
    .firestore();

const member = { status: 'active', role: 'member', admin: false };
const everything = { status: 'active', role: 'manager', admin: true };

describe('the email-and-password account', () => {
  it('reads its own profile and its own hours', async () => {
    const db = password('rev', PASSWORD_ACCOUNT_EMAIL, member);
    await assertSucceeds(getDoc(doc(db, 'users/rev')));
    await assertSucceeds(getDoc(doc(db, 'timeEntries/rev-1')));
    await assertSucceeds(getDocs(query(collection(db, 'timeEntries'), where('uid', '==', 'rev'))));
    // An approver's profile, like any member, to pick its approver.
    await assertSucceeds(getDoc(doc(db, 'users/boss')));
  });

  it('sees nobody else’s hours or profile', async () => {
    const db = password('rev', PASSWORD_ACCOUNT_EMAIL, member);
    await assertFails(getDoc(doc(db, 'timeEntries/alice-1')));
    await assertFails(getDocs(collection(db, 'timeEntries')));
    await assertFails(getDoc(doc(db, 'users/alice')));
  });

  it('is never a manager or an admin, even with those claims', async () => {
    const db = password('rev', PASSWORD_ACCOUNT_EMAIL, everything);
    await assertFails(getDoc(doc(db, 'timeEntries/alice-1')));
    await assertFails(getDocs(collection(db, 'timeEntries')));
    await assertFails(getDoc(doc(db, 'users/alice')));
    await assertFails(getDocs(collection(db, 'users')));
  });
});

describe('a password session for any other address', () => {
  it('is signed out, whatever its claims', async () => {
    for (const claims of [member, everything]) {
      const db = password('stray', 'stray@oursabeel.com', claims);
      await assertFails(getDoc(doc(db, 'users/stray')));
      await assertFails(getDoc(doc(db, 'timeEntries/stray-1')));
      await assertFails(getDoc(doc(db, 'users/boss')));
    }
  });
});

describe('a Google session with the same claims (the control)', () => {
  it('keeps its manager and admin rights', async () => {
    const db = testEnv
      .authenticatedContext('boss', { ...everything, email: 'boss@oursabeel.com', firebase: { sign_in_provider: 'google.com', identities: {} } })
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'timeEntries/alice-1')));
    await assertSucceeds(getDoc(doc(db, 'users/alice')));
  });
});
