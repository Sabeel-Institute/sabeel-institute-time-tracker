import { describe, it, beforeAll, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { EMULATOR_PROJECT_ID } from '@sabeel/shared';
import { accountExistsFor } from '../../src/accountExists';

// Runs under `firebase emulators:exec` (auth + firestore), calling the
// callable's core directly, as authTrigger.test.ts does with applyProvision.
//
// The promise behind this function is that asking CREATES NOTHING, so every
// "no" below also counts the auth users afterwards. A version that answered
// `exists: false` while quietly minting a record would pass a return-value
// test and break the only claim that matters to the stores.

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

/** The unsigned token the Auth emulator accepts, as devSignIn.ts makes it. */
const token = (email: string, verified = true) =>
  JSON.stringify({ sub: `dev-${email}`, email, email_verified: verified });

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@oursabeel.com`;

async function userCount(): Promise<number> {
  let n = 0;
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    n += page.users.length;
    pageToken = page.pageToken;
  } while (pageToken);
  return n;
}

describe('accountExistsFor', () => {
  it('runs against the emulator project, so the emulator token dialect applies', () => {
    expect(process.env.GCLOUD_PROJECT).toBe(EMULATOR_PROJECT_ID);
  });

  it('says no for a colleague on the allowed domain who has no account, and creates none', async () => {
    const before = await userCount();
    await expect(accountExistsFor(token(unique('newcomer')))).resolves.toEqual({ exists: false });
    expect(await userCount()).toBe(before);
  });

  it('says yes for an existing account', async () => {
    const email = unique('existing');
    await getAuth().createUser({ email, emailVerified: true });
    await expect(accountExistsFor(token(email))).resolves.toEqual({ exists: true });
  });

  it('says no for an unverified address, even one that matches an account', async () => {
    const email = unique('unverified');
    await getAuth().createUser({ email, emailVerified: true });
    const before = await userCount();
    await expect(accountExistsFor(token(email, false))).resolves.toEqual({ exists: false });
    expect(await userCount()).toBe(before);
  });

  it('refuses an unreadable token as unauthenticated, not as "no account"', async () => {
    await expect(accountExistsFor('not a token')).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('refuses a missing token', async () => {
    await expect(accountExistsFor(undefined)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(accountExistsFor('')).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
