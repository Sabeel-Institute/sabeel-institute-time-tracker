import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const pendingProfile = {
  displayName: 'New Volunteer',
  email: 'new@oursabeel.com',
  photoURL: null,
  status: 'pending',
  role: 'member',
  admin: false,
  activeEntryId: null,
  approverUid: null,
  createdAt: 1,
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
    projectId: 'demo-sabeel',
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

const activeClaims = { status: 'active', role: 'member' };
const managerClaims = { status: 'active', role: 'manager' };

describe('firestore.rules — users are provisioned server-side (no client create)', () => {
  // The onUserCreate trigger is the sole provisioner (admin SDK, bypasses rules);
  // clients never create their own profile. Domain enforcement + the pending
  // shape are asserted in provision.test.ts / authTrigger.test.ts, not here.
  it('denies client profile creation for everyone — org and non-org alike', async () => {
    const org = testEnv.authenticatedContext('alice', {
      email: 'alice@oursabeel.com',
      email_verified: true,
    });
    await assertFails(setDoc(doc(org.firestore(), 'users/alice'), pendingProfile));

    const outsider = testEnv.authenticatedContext('mallory', {
      email: 'mallory@gmail.com',
      email_verified: true,
    });
    await assertFails(setDoc(doc(outsider.firestore(), 'users/mallory'), pendingProfile));
  });

  it('blocks anonymous access entirely', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(anon.firestore(), 'users/alice')));
    await assertFails(setDoc(doc(anon.firestore(), 'users/anon'), pendingProfile));
  });
});

describe('firestore.rules — users privilege escalation', () => {
  it('blocks a user from changing their own role/status/admin', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), {
        ...pendingProfile,
        status: 'active',
      });
    });
    const alice = testEnv.authenticatedContext('alice', activeClaims);
    const me = doc(alice.firestore(), 'users/alice');
    await assertFails(updateDoc(me, { role: 'manager' }));
    await assertFails(updateDoc(me, { admin: true }));
    await assertFails(updateDoc(me, { status: 'active', role: 'manager' }));
    // But the allowed self-service fields work:
    await assertSucceeds(updateDoc(me, { displayName: 'Alice A.' }));
    await assertSucceeds(updateDoc(me, { activeEntryId: 'entry1' }));
  });

  it('pending users (no active claim) cannot even self-update cosmetics', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/carol'), pendingProfile);
    });
    const carol = testEnv.authenticatedContext('carol', { status: 'pending', role: 'member' });
    await assertFails(updateDoc(doc(carol.firestore(), 'users/carol'), { displayName: 'C' }));
  });

  it('admins who are not managers can still read profiles (approval needs name+email)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/newbie'), pendingProfile);
    });
    const admin = testEnv.authenticatedContext('adm', {
      status: 'active',
      role: 'member',
      admin: true,
    });
    await assertSucceeds(getDoc(doc(admin.firestore(), 'users/newbie')));
  });

  it('managers can read any profile; members only their own', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), { ...pendingProfile, status: 'active' });
    });
    const manager = testEnv.authenticatedContext('mgr', managerClaims);
    await assertSucceeds(getDoc(doc(manager.firestore(), 'users/alice')));
    const bob = testEnv.authenticatedContext('bob', activeClaims);
    await assertFails(getDoc(doc(bob.firestore(), 'users/alice')));
  });
});

describe('firestore.rules — approver assignment', () => {
  // alice: active member; mgr: active manager; adm: active admin (non-manager);
  // bob: active member (invalid approver target).
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users/alice'), { ...pendingProfile, status: 'active' });
      await setDoc(doc(db, 'users/bob'), { ...pendingProfile, status: 'active' });
      await setDoc(doc(db, 'users/mgr'), {
        ...pendingProfile,
        status: 'active',
        role: 'manager',
      });
      await setDoc(doc(db, 'users/adm'), { ...pendingProfile, status: 'active', admin: true });
    });
  });

  const alice = () => testEnv.authenticatedContext('alice', activeClaims);
  const mgr = () => testEnv.authenticatedContext('mgr', managerClaims);
  const adm = () =>
    testEnv.authenticatedContext('adm', { status: 'active', role: 'member', admin: true });

  it('self-set: to an active manager ✓, to an admin ✓, to a plain member ✗, to null ✓', async () => {
    const me = doc(alice().firestore(), 'users/alice');
    await assertSucceeds(updateDoc(me, { approverUid: 'mgr' }));
    await assertSucceeds(updateDoc(me, { approverUid: 'adm' }));
    await assertFails(updateDoc(me, { approverUid: 'bob' }));
    await assertSucceeds(updateDoc(me, { approverUid: null }));
  });

  it("manager sets a member's approver ✓, an admin's ✗, and nothing else ✗", async () => {
    await assertSucceeds(
      updateDoc(doc(mgr().firestore(), 'users/alice'), { approverUid: 'mgr' }),
    );
    await assertFails(updateDoc(doc(mgr().firestore(), 'users/adm'), { approverUid: 'mgr' }));
    await assertFails(
      updateDoc(doc(mgr().firestore(), 'users/alice'), { approverUid: 'mgr', role: 'manager' }),
    );
    await assertFails(updateDoc(doc(mgr().firestore(), 'users/alice'), { status: 'disabled' }));
  });

  it("admin sets anyone's approver, including another admin's", async () => {
    await assertSucceeds(
      updateDoc(doc(adm().firestore(), 'users/alice'), { approverUid: 'mgr' }),
    );
    await assertSucceeds(updateDoc(doc(adm().firestore(), 'users/mgr'), { approverUid: 'adm' }));
  });

  it('members cannot set other people’s approver', async () => {
    await assertFails(updateDoc(doc(alice().firestore(), 'users/bob'), { approverUid: 'mgr' }));
  });

  it('active members read manager/admin profiles (approver picking) but not other members', async () => {
    await assertSucceeds(getDoc(doc(alice().firestore(), 'users/mgr')));
    await assertSucceeds(getDoc(doc(alice().firestore(), 'users/adm')));
    await assertFails(getDoc(doc(alice().firestore(), 'users/bob')));
  });

  it('cannot point approverUid at a disabled or pending manager', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/oldmgr'), {
        ...pendingProfile,
        status: 'disabled',
        role: 'manager',
      });
    });
    await assertFails(
      updateDoc(doc(alice().firestore(), 'users/alice'), { approverUid: 'oldmgr' }),
    );
  });
});

describe('firestore.rules — notification prefs & push tokens', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users/alice'), { ...pendingProfile, status: 'active' });
      await setDoc(doc(db, 'users/bob'), { ...pendingProfile, status: 'active' });
    });
  });

  const alice = () => testEnv.authenticatedContext('alice', activeClaims);
  const bob = () => testEnv.authenticatedContext('bob', activeClaims);

  it('self-updates notifPrefs and timeZone', async () => {
    const me = doc(alice().firestore(), 'users/alice');
    await assertSucceeds(updateDoc(me, { notifPrefs: { reminder: false } }));
    await assertSucceeds(updateDoc(me, { timeZone: 'Asia/Singapore' }));
  });

  it('cannot write lastReminderDayKey (server-only) or others’ prefs', async () => {
    await assertFails(
      updateDoc(doc(alice().firestore(), 'users/alice'), { lastReminderDayKey: '2026-07-14' }),
    );
    await assertFails(
      updateDoc(doc(bob().firestore(), 'users/alice'), { notifPrefs: { reminder: false } }),
    );
  });

  it('push tokens: owner full control, others locked out, shape validated', async () => {
    const mine = doc(alice().firestore(), 'users/alice/pushTokens/tok1');
    await assertSucceeds(setDoc(mine, { token: 'tok1', platform: 'web', updatedAt: 1 }));
    await assertSucceeds(getDoc(mine));
    await assertFails(
      setDoc(doc(alice().firestore(), 'users/alice/pushTokens/tok2'), {
        token: 'tok2',
        platform: 'ios',
        updatedAt: 1,
      }),
    );
    await assertFails(getDoc(doc(bob().firestore(), 'users/alice/pushTokens/tok1')));
    await assertFails(
      setDoc(doc(bob().firestore(), 'users/alice/pushTokens/evil'), {
        token: 'evil',
        platform: 'web',
        updatedAt: 1,
      }),
    );
  });

  it('push tokens: an iPhone registers with the Apple service its token came from', async () => {
    const at = (id: string) => doc(alice().firestore(), `users/alice/pushTokens/${id}`);
    const ios = (id: string, apnsEnvironment: unknown) => ({ token: id, platform: 'ios', apnsEnvironment, updatedAt: 1 });
    await assertSucceeds(setDoc(at('ios-dev'), ios('ios-dev', 'development')));
    await assertSucceeds(setDoc(at('ios-prod'), ios('ios-prod', 'production')));
    await assertSucceeds(setDoc(at('droid'), { token: 'droid', platform: 'android', updatedAt: 1 }));

    // An iPhone that does not say which service: the server could not send to it.
    await assertFails(setDoc(at('ios-none'), { token: 'ios-none', platform: 'ios', updatedAt: 1 }));
    await assertFails(setDoc(at('ios-bad'), ios('ios-bad', 'sandbox')));
    // The Apple field on an FCM row, and any field nobody validates.
    await assertFails(
      setDoc(at('droid-env'), { token: 'droid-env', platform: 'android', apnsEnvironment: 'production', updatedAt: 1 }),
    );
    await assertFails(setDoc(at('extra'), { token: 'extra', platform: 'web', updatedAt: 1, note: 'x' }));
    // The doc id is the address the server sends to: it must be the token.
    await assertFails(setDoc(at('other-id'), { token: 'not-the-id', platform: 'web', updatedAt: 1 }));
    await assertFails(setDoc(at('no-time'), { token: 'no-time', platform: 'web' }));
  });

  it('an account that is not active cannot register for push', async () => {
    const carol = testEnv.authenticatedContext('carol', { status: 'pending', role: 'member' });
    await assertFails(
      setDoc(doc(carol.firestore(), 'users/carol/pushTokens/tok1'), {
        token: 'tok1',
        platform: 'android',
        updatedAt: 1,
      }),
    );

    // Deleting stays open to any signed-in owner: sign-out deregisters the device,
    // and that has to keep working for someone disabled mid-session — otherwise
    // their tokens outlive them and the next person on the phone inherits them.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/carol/pushTokens/tok1'), {
        token: 'tok1',
        platform: 'android',
      });
    });
    const disabled = testEnv.authenticatedContext('carol', {
      status: 'disabled',
      role: 'member',
    });
    await assertSucceeds(deleteDoc(doc(disabled.firestore(), 'users/carol/pushTokens/tok1')));
  });

  it('display name is bounded: non-empty, not unbounded', async () => {
    const me = doc(alice().firestore(), 'users/alice');
    await assertFails(updateDoc(me, { displayName: '' }));
    await assertFails(updateDoc(me, { displayName: 'x'.repeat(101) }));
    await assertSucceeds(updateDoc(me, { displayName: 'Alice Anderson' }));
  });
});
