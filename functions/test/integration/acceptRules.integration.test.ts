import { describe, it, beforeAll, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  EMULATOR_PROJECT_ID,
  hasAcceptedRules,
  PASSWORD_ACCOUNT_EMAIL,
  RULES_VERSION,
  type UserDoc,
} from '@sabeel/shared';
import { acceptRulesFor } from '../../src/acceptRules';

/**
 * The institute's rules, accepted once and recorded by the server: after
 * acceptRules the profile says so (which is what moves the app past the rules
 * screen, on every device), a second acceptance changes nothing, and an
 * account that is not active records nothing.
 *
 * That a CLIENT cannot write the record itself is firestore.rules' promise,
 * asserted in rules.reports.test.ts.
 */

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

const freshUid = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function account(uid: string, email: string, status: UserDoc['status']) {
  await getFirestore().collection(COLLECTIONS.users).doc(uid).set({
    displayName: uid,
    email,
    photoURL: null,
    status,
    role: 'member',
    admin: false,
    activeEntryId: null,
    approverUid: null,
    createdAt: 1,
  });
}

const req = (uid: string, email: string, status: string, provider = 'google.com') =>
  ({
    auth: { uid, token: { status, role: 'member', admin: false, email, firebase: { sign_in_provider: provider } } },
    data: {},
    rawRequest: {},
  }) as unknown as CallableRequest;

const profileOf = async (uid: string) =>
  (await getFirestore().collection(COLLECTIONS.users).doc(uid).get()).data() as UserDoc;

describe('acceptRules', () => {
  it('records the current version and when, on the person’s own profile', async () => {
    const uid = freshUid('agree');
    await account(uid, `${uid}@oursabeel.com`, 'active');
    expect(hasAcceptedRules(await profileOf(uid))).toBe(false);

    const before = Date.now();
    await expect(acceptRulesFor(req(uid, `${uid}@oursabeel.com`, 'active'))).resolves.toEqual({ rulesVersion: RULES_VERSION });

    const p = await profileOf(uid);
    expect(hasAcceptedRules(p)).toBe(true);
    expect(p.rulesVersion).toBe(RULES_VERSION);
    expect(p.rulesAcceptedAt).toBeGreaterThanOrEqual(before);
    expect(p.rulesAcceptedAt).toBeLessThanOrEqual(Date.now());
    // Nothing else on the profile moved.
    expect(p).toMatchObject({ status: 'active', role: 'member', admin: false, approverUid: null });
  });

  it('a second acceptance keeps the first one’s time', async () => {
    const uid = freshUid('again');
    await account(uid, `${uid}@oursabeel.com`, 'active');
    await acceptRulesFor(req(uid, `${uid}@oursabeel.com`, 'active'));
    const first = (await profileOf(uid)).rulesAcceptedAt;
    await new Promise((r) => setTimeout(r, 5));
    await acceptRulesFor(req(uid, `${uid}@oursabeel.com`, 'active'));
    expect((await profileOf(uid)).rulesAcceptedAt).toBe(first);
  });

  it('the review account, through the email door, accepts like anyone', async () => {
    const uid = freshUid('reviewer');
    await account(uid, PASSWORD_ACCOUNT_EMAIL, 'active');
    await acceptRulesFor(req(uid, PASSWORD_ACCOUNT_EMAIL, 'active', 'password'));
    expect(hasAcceptedRules(await profileOf(uid))).toBe(true);
  });

  it('an account that is not active records nothing', async () => {
    for (const status of ['pending', 'disabled'] as const) {
      const uid = freshUid(status);
      await account(uid, `${uid}@oursabeel.com`, status);
      await expect(acceptRulesFor(req(uid, `${uid}@oursabeel.com`, status))).rejects.toMatchObject({
        code: 'permission-denied',
      });
      const p = await profileOf(uid);
      expect(p).not.toHaveProperty('rulesVersion');
      expect(p).not.toHaveProperty('rulesAcceptedAt');
    }
  });
});
