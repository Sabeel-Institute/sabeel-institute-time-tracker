import { describe, it, beforeAll, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { applyProvision } from '../../src/authTrigger';
import { EMULATOR_PROJECT_ID } from '@sabeel/shared';

// Runs under `firebase emulators:exec` (firestore + auth). We invoke the trigger's
// extracted core directly — the same pattern as users.integration.test.ts driving
// applyUserAccess — so no functions emulator is needed. The end-to-end firing of
// the real trigger on sign-in is covered by scripts/web-e2e.mjs.

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

function freshUid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Create the auth user (as sign-in would), then run provisioning against it. */
async function signUp(prefix: string, domain: string, emailVerified: boolean, displayName?: string) {
  const uid = freshUid(prefix);
  const email = `${uid}@${domain}`;
  await getAuth().createUser({ uid, email, emailVerified, ...(displayName ? { displayName } : {}) });
  const decision = await applyProvision({ uid, email, emailVerified, displayName });
  return { uid, email, decision };
}

const userDoc = (uid: string) => getFirestore().doc(`users/${uid}`).get();
const userGone = async (uid: string) => {
  try {
    await getAuth().getUser(uid);
    return false;
  } catch {
    return true;
  }
};

describe('applyProvision — domain enforcement (consent screen bypassed)', () => {
  it('deletes a non-org account and writes no user doc', async () => {
    const { uid, decision } = await signUp('intruder', 'gmail.com', true);
    expect(decision.action).toBe('reject');
    expect(await userGone(uid)).toBe(true);
    expect((await userDoc(uid)).exists).toBe(false);
  });

  it('rejects look-alike and unverified org addresses', async () => {
    const evil = await signUp('lookalike', 'evil-oursabeel.com', true);
    expect(evil.decision.action).toBe('reject');
    expect(await userGone(evil.uid)).toBe(true);

    const suffix = await signUp('lookalike', 'oursabeel.com.attacker.net', true);
    expect(suffix.decision.action).toBe('reject');
    expect(await userGone(suffix.uid)).toBe(true);

    const unverified = await signUp('unverified', 'oursabeel.com', false);
    expect(unverified.decision.action).toBe('reject');
    expect(await userGone(unverified.uid)).toBe(true);
  });
});

describe('applyProvision — provisioning a valid org account', () => {
  it('writes a pending/member/non-admin doc AND matching pending claims', async () => {
    const { uid, email } = await signUp('newbie', 'oursabeel.com', true, 'New Bie');

    const snap = await userDoc(uid);
    expect(snap.exists).toBe(true);
    expect(snap.data()).toMatchObject({
      status: 'pending',
      role: 'member',
      admin: false,
      email,
      displayName: 'New Bie',
      activeEntryId: null,
      approverUid: null,
    });
    expect(typeof snap.data()!.claimsUpdatedAt).toBe('number');

    // Rules trust the TOKEN — the claims must match the doc, not just exist.
    const rec = await getAuth().getUser(uid);
    expect(rec.customClaims).toMatchObject({ status: 'pending', role: 'member', admin: false });
    expect(await userGone(uid)).toBe(false);
  });

  it('never provisions active, and falls back to the local part for a missing name', async () => {
    const { uid, email } = await signUp('nameless', 'oursabeel.com', true); // no displayName
    const snap = await userDoc(uid);
    expect(snap.data()!.status).toBe('pending');
    expect(snap.data()!.displayName).toBe(email.slice(0, email.indexOf('@')));
  });
});
