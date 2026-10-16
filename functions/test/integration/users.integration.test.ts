import { describe, it, beforeAll, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { applyUserAccess } from '../../src/users';

// Runs under `firebase emulators:exec` — FIRESTORE_EMULATOR_HOST and
// FIREBASE_AUTH_EMULATOR_HOST are set, so the admin SDK talks to the emulators.

function freshUid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function seedUser(uid: string, doc: Record<string, unknown>) {
  await getAuth().createUser({ uid, email: `${uid}@example.com` });
  await getFirestore().collection('users').doc(uid).set({
    displayName: uid,
    email: `${uid}@example.com`,
    photoURL: null,
    status: 'pending',
    role: 'member',
    admin: false,
    activeEntryId: null,
    createdAt: Date.now(),
    ...doc,
  });
}

beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: 'demo-sabeel' });
  }
});

describe('applyUserAccess (admin approval flow)', () => {
  it('approves a pending user: doc updated, claims mirrored, audit fields set', async () => {
    const admin = freshUid('admin');
    const target = freshUid('newbie');
    await seedUser(admin, { status: 'active', admin: true });
    await seedUser(target, {});

    const result = await applyUserAccess(admin, { uid: target, status: 'active' });
    expect(result).toEqual({ status: 'active', role: 'member', admin: false });

    const doc = (await getFirestore().collection('users').doc(target).get()).data()!;
    expect(doc.status).toBe('active');
    expect(doc.approvedBy).toBe(admin);
    expect(doc.approvedAt).toBeTruthy();

    const claims = (await getAuth().getUser(target)).customClaims;
    expect(claims).toEqual({ status: 'active', role: 'member', admin: false });
  });

  it('promotes to manager without touching status', async () => {
    const admin = freshUid('admin');
    const target = freshUid('member');
    await seedUser(admin, { status: 'active', admin: true });
    await seedUser(target, { status: 'active' });

    const result = await applyUserAccess(admin, { uid: target, role: 'manager' });
    expect(result).toEqual({ status: 'active', role: 'manager', admin: false });
  });

  it('refuses self-demotion and self-disable (lockout guard)', async () => {
    const admin = freshUid('admin');
    await seedUser(admin, { status: 'active', admin: true });

    await expect(applyUserAccess(admin, { uid: admin, admin: false })).rejects.toThrow(
      HttpsError,
    );
    await expect(applyUserAccess(admin, { uid: admin, status: 'disabled' })).rejects.toThrow(
      /cannot demote or disable yourself/,
    );
  });

  it('404s on a user without a profile doc', async () => {
    const admin = freshUid('admin');
    await seedUser(admin, { status: 'active', admin: true });
    await expect(applyUserAccess(admin, { uid: 'ghost-uid', status: 'active' })).rejects.toThrow(
      /No such user/,
    );
  });
});

/**
 * An approver is validated when the pointer is written and never again, so a
 * pointer that outlives the role would keep routing submissions to someone no
 * longer entitled to decide. Losing eligibility must drop the pointers.
 */
describe('applyUserAccess — an email-and-password account', () => {
  // The one such account is made by an administrator with the Admin SDK,
  // exactly like this (docs/STORE-RELEASE.md, "Review access").
  async function passwordAccount() {
    const uid = freshUid('pw');
    await getAuth().createUser({ uid, email: `${uid}@example.com`, password: 'a-long-generated-password', emailVerified: true });
    await getFirestore().collection('users').doc(uid).set({
      displayName: uid,
      email: `${uid}@example.com`,
      photoURL: null,
      status: 'pending',
      role: 'member',
      admin: false,
      activeEntryId: null,
      createdAt: Date.now(),
    });
    return uid;
  }

  it('is approved as a member, the ordinary way', async () => {
    const admin = freshUid('admin');
    await seedUser(admin, { status: 'active', admin: true });
    const uid = await passwordAccount();
    await expect(applyUserAccess(admin, { uid, status: 'active' })).resolves.toEqual({
      status: 'active',
      role: 'member',
      admin: false,
    });
  });

  it('is never made a manager or an admin', async () => {
    const admin = freshUid('admin');
    await seedUser(admin, { status: 'active', admin: true });
    const uid = await passwordAccount();
    await expect(applyUserAccess(admin, { uid, role: 'manager' })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(applyUserAccess(admin, { uid, admin: true })).rejects.toMatchObject({ code: 'failed-precondition' });
    // Nothing was written on the way to the refusal.
    expect((await getAuth().getUser(uid)).customClaims ?? {}).not.toHaveProperty('role', 'manager');
    expect((await getFirestore().doc(`users/${uid}`).get()).data()).toMatchObject({ role: 'member', admin: false });
  });
});

describe('applyUserAccess — approver pointer cleanup', () => {
  const approverOf = async (uid: string) =>
    (await getFirestore().collection('users').doc(uid).get()).data()?.approverUid;

  it('demoting a manager clears every pointer at them, their own included', async () => {
    const admin = freshUid('admin');
    const mgr = freshUid('mgr');
    const alice = freshUid('alice');
    await seedUser(admin, { status: 'active', admin: true });
    // Self-approving manager (M5) — the pointer at themselves must go too.
    await seedUser(mgr, { status: 'active', role: 'manager', approverUid: mgr });
    await seedUser(alice, { status: 'active', approverUid: mgr });

    await applyUserAccess(admin, { uid: mgr, role: 'member' });

    expect(await approverOf(mgr)).toBeNull();
    expect(await approverOf(alice)).toBeNull();
  });

  it('disabling an approver clears pointers even though the role is untouched', async () => {
    const admin = freshUid('admin');
    const mgr = freshUid('mgr');
    const alice = freshUid('alice');
    await seedUser(admin, { status: 'active', admin: true });
    await seedUser(mgr, { status: 'active', role: 'manager' });
    await seedUser(alice, { status: 'active', approverUid: mgr });

    await applyUserAccess(admin, { uid: mgr, status: 'disabled' });

    expect(await approverOf(alice)).toBeNull();
  });

  it('revoking admin from a non-manager clears pointers; a manager-admin keeps them', async () => {
    const admin = freshUid('admin');
    const soleAdmin = freshUid('adminonly');
    const mgrAdmin = freshUid('mgradmin');
    const alice = freshUid('alice');
    const bob = freshUid('bob');
    await seedUser(admin, { status: 'active', admin: true });
    await seedUser(soleAdmin, { status: 'active', admin: true });
    await seedUser(mgrAdmin, { status: 'active', role: 'manager', admin: true });
    await seedUser(alice, { status: 'active', approverUid: soleAdmin });
    await seedUser(bob, { status: 'active', approverUid: mgrAdmin });

    await applyUserAccess(admin, { uid: soleAdmin, admin: false });
    await applyUserAccess(admin, { uid: mgrAdmin, admin: false });

    expect(await approverOf(alice)).toBeNull();
    // Still an active manager, so still a valid approver.
    expect(await approverOf(bob)).toBe(mgrAdmin);
  });

  /**
   * Claims alone don't stop someone already holding an ID token — rules trust the
   * token, and it lives up to an hour. Revoking the refresh token is what stops a
   * backgrounded or offline client from simply carrying on.
   */
  it('revokes refresh tokens when access is lost, not when it is granted', async () => {
    const admin = freshUid('admin');
    const target = freshUid('mgr');
    await seedUser(admin, { status: 'active', admin: true });
    await seedUser(target, { status: 'active', role: 'manager' });

    // Undefined until something revokes — that absence is the "not revoked" state.
    const validAfter = async () => (await getAuth().getUser(target)).tokensValidAfterTime;
    expect(await validAfter()).toBeFalsy();

    await applyUserAccess(admin, { uid: target, status: 'active', role: 'member' });
    const afterDemote = await validAfter();
    expect(afterDemote).toBeTruthy();

    // Promotion grants access — nothing to cut off, so no further revocation.
    await applyUserAccess(admin, { uid: target, role: 'manager' });
    expect(await validAfter()).toBe(afterDemote);
  });

  it('revokes on disable', async () => {
    const admin = freshUid('admin');
    const target = freshUid('victim');
    await seedUser(admin, { status: 'active', admin: true });
    await seedUser(target, { status: 'active' });

    expect((await getAuth().getUser(target)).tokensValidAfterTime).toBeFalsy();
    await applyUserAccess(admin, { uid: target, status: 'disabled' });
    expect((await getAuth().getUser(target)).tokensValidAfterTime).toBeTruthy();
  });

  it('leaves pointers alone when eligibility is gained or unchanged', async () => {
    const admin = freshUid('admin');
    const mgr = freshUid('mgr');
    const alice = freshUid('alice');
    await seedUser(admin, { status: 'active', admin: true });
    await seedUser(mgr, { status: 'active', role: 'manager' });
    await seedUser(alice, { status: 'active', approverUid: mgr });

    await applyUserAccess(admin, { uid: mgr, admin: true }); // promotion
    expect(await approverOf(alice)).toBe(mgr);
  });
});
