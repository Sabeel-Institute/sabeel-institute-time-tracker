import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { EMULATOR_PROJECT_ID, PASSWORD_ACCOUNT_EMAIL } from '@sabeel/shared';

let testEnv: RulesTestEnvironment;

const activity = {
  name: 'Food Drive',
  status: 'active',
  createdAt: 1,
  createdBy: 'mgr',
};

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
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const member = () =>
  testEnv.authenticatedContext('mem', { status: 'active', role: 'member' });
const manager = () =>
  testEnv.authenticatedContext('mgr', { status: 'active', role: 'manager' });
// Admin who is NOT a manager (role member) — M3 lets them manage activities too.
const adminNonManager = () =>
  testEnv.authenticatedContext('adm', { status: 'active', role: 'member', admin: true });
const pendingUser = () =>
  testEnv.authenticatedContext('pen', { status: 'pending', role: 'member' });
const admin = () =>
  testEnv.authenticatedContext('boss', { status: 'active', role: 'manager', admin: true });
// The same claims on the email-and-password account, which is never an admin.
const passwordAdmin = () =>
  testEnv.authenticatedContext('rev', {
    status: 'active',
    role: 'manager',
    admin: true,
    email: PASSWORD_ACCOUNT_EMAIL,
    firebase: { sign_in_provider: 'password', identities: {} },
  });

describe('firestore.rules — activities', () => {
  it('managers create and archive activities', async () => {
    const m = manager();
    await assertSucceeds(addDoc(collection(m.firestore(), 'activities'), activity));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'activities/a1'), activity);
    });
    await assertSucceeds(
      updateDoc(doc(m.firestore(), 'activities/a1'), { status: 'archived' }),
    );
  });

  it('M3: an admin who is not a manager can create and archive activities', async () => {
    const a = adminNonManager();
    await assertSucceeds(addDoc(collection(a.firestore(), 'activities'), activity));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'activities/a1'), activity);
    });
    await assertSucceeds(
      updateDoc(doc(a.firestore(), 'activities/a1'), { status: 'archived' }),
    );
  });

  it('members and pending users cannot write activities', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'activities/a1'), activity);
    });
    await assertFails(addDoc(collection(member().firestore(), 'activities'), activity));
    await assertFails(
      updateDoc(doc(member().firestore(), 'activities/a1'), { status: 'archived' }),
    );
    await assertFails(addDoc(collection(pendingUser().firestore(), 'activities'), activity));
  });

  it('active members can read/list; pending users cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'activities/a1'), activity);
    });
    await assertSucceeds(getDocs(collection(member().firestore(), 'activities')));
    await assertFails(getDocs(collection(pendingUser().firestore(), 'activities')));
  });

  describe('deleting', () => {
    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'activities/live'), activity);
        await setDoc(doc(ctx.firestore(), 'activities/old'), { ...activity, status: 'archived' });
      });
    });

    it('an admin deletes an archived activity', async () => {
      await assertSucceeds(deleteDoc(doc(admin().firestore(), 'activities/old')));
    });

    it('an admin cannot delete an activity that is still active', async () => {
      await assertFails(deleteDoc(doc(admin().firestore(), 'activities/live')));
    });

    it('managers, members and pending users cannot delete', async () => {
      for (const who of [manager, member, pendingUser]) {
        await assertFails(deleteDoc(doc(who().firestore(), 'activities/old')));
      }
    });

    it('a password session with admin claims cannot delete', async () => {
      await assertFails(deleteDoc(doc(passwordAdmin().firestore(), 'activities/old')));
    });
  });

  it('creation is validated: empty name rejected', async () => {
    const m = manager();
    await assertFails(
      addDoc(collection(m.firestore(), 'activities'), { ...activity, name: '' }),
    );
  });

  // Updates used to check only `status`, which left archive/restore free to blank
  // the name or rewrite the provenance fields on the way past.
  describe('updates are validated too, not just the status field', () => {
    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'activities/a1'), activity);
      });
    });

    it('archiving and restoring still work', async () => {
      const db = manager().firestore();
      await assertSucceeds(updateDoc(doc(db, 'activities/a1'), { status: 'archived' }));
      await assertSucceeds(updateDoc(doc(db, 'activities/a1'), { status: 'active' }));
    });

    it('rejects blanking the name', async () => {
      await assertFails(updateDoc(doc(manager().firestore(), 'activities/a1'), { name: '' }));
    });

    it('rejects rewriting who created it, or when', async () => {
      const db = manager().firestore();
      await assertFails(updateDoc(doc(db, 'activities/a1'), { createdBy: 'someone-else' }));
      await assertFails(updateDoc(doc(db, 'activities/a1'), { createdAt: 999 }));
    });
  });
});
