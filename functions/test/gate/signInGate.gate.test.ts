import { describe, it, beforeAll, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { EMULATOR_PROJECT_ID, PASSWORD_ACCOUNT_EMAIL, SIGN_IN_REFUSED } from '@sabeel/shared';

/*
 * THE DOOR HOLDS AT THE AUTH LAYER, BEFORE ANY ACCOUNT EXISTS. Driven the way
 * an outsider would: the public Auth REST API with the site's key, against the
 * Auth emulator, which calls the blocking functions the Functions emulator runs
 * (scripts/test-emulator.sh, the second pass). The promise is in what is left
 * behind, not only in an error code: a refused sign-up leaves no account.
 *
 * The administrator's path is the Admin SDK, which blocking functions do not
 * see; that is asserted here too, since everything else rests on it.
 */

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

async function rest(method: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${AUTH}/${method}?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { error?: { message?: string } };
  return { ok: res.ok, message: json.error?.message ?? '' };
}

const PASSWORD = 'a-long-generated-password-for-tests';
const signUp = (email: string) => rest('accounts:signUp', { email, password: PASSWORD, returnSecureToken: true });
const signIn = (email: string) =>
  rest('accounts:signInWithPassword', { email, password: PASSWORD, returnSecureToken: true });
const googleSignIn = (email: string) =>
  rest('accounts:signInWithIdp', {
    requestUri: 'http://localhost',
    postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `g-${email}`, email, email_verified: true }))}&providerId=google.com`,
    returnSecureToken: true,
  });

const accountFor = (email: string) =>
  getAuth()
    .getUserByEmail(email)
    .then(
      (u) => u.uid,
      () => null,
    );

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@oursabeel.com`;

describe('password sign-up through the public API', () => {
  it('is refused for any address, and no account is made', async () => {
    const email = unique('stranger');
    const res = await signUp(email);
    expect(res.ok).toBe(false);
    expect(res.message).toContain(SIGN_IN_REFUSED);
    expect(await accountFor(email)).toBeNull();
  });

  it('is refused for the allowed address too: that account is made by an administrator', async () => {
    await getAuth()
      .getUserByEmail(PASSWORD_ACCOUNT_EMAIL)
      .then((u) => getAuth().deleteUser(u.uid))
      .catch(() => undefined);
    const res = await signUp(PASSWORD_ACCOUNT_EMAIL);
    expect(res.ok).toBe(false);
    expect(res.message).toContain(SIGN_IN_REFUSED);
    expect(await accountFor(PASSWORD_ACCOUNT_EMAIL)).toBeNull();
  });
});

describe('the administrator’s path, and password sign-in', () => {
  it('the Admin SDK makes the account (blocking functions do not see it), and it signs in', async () => {
    await getAuth()
      .getUserByEmail(PASSWORD_ACCOUNT_EMAIL)
      .then((u) => getAuth().deleteUser(u.uid))
      .catch(() => undefined);
    await getAuth().createUser({ email: PASSWORD_ACCOUNT_EMAIL, password: PASSWORD, emailVerified: true });
    expect(await accountFor(PASSWORD_ACCOUNT_EMAIL)).not.toBeNull();
    await expect(signIn(PASSWORD_ACCOUNT_EMAIL)).resolves.toMatchObject({ ok: true });
  });

  it('refuses a password sign-in for any other address, even one an administrator made', async () => {
    const email = unique('second-password');
    await getAuth().createUser({ email, password: PASSWORD, emailVerified: true });
    const res = await signIn(email);
    expect(res.ok).toBe(false);
    expect(res.message).toContain(SIGN_IN_REFUSED);
  });
});

describe('Google', () => {
  it('a colleague’s first Google sign-in still makes their account', async () => {
    const email = unique('colleague');
    const res = await googleSignIn(email);
    expect(res).toMatchObject({ ok: true, message: '' });
    expect(await accountFor(email)).not.toBeNull();
  });
});
