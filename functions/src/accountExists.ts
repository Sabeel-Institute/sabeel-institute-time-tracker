import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { OAuth2Client } from 'google-auth-library';
import { WEB_CLIENT_ID } from '@sabeel/shared';
import { isEmulatorProject } from './env';
import { guarded, sentryDsn } from './sentry';

/**
 * Does an account already exist for the holder of this Google ID token?
 *
 * THE PHONE APPS NEVER CREATE AN ACCOUNT. Both stores require in-app account
 * deletion only if an app supports account creation (Play also if it points at
 * a sign-up elsewhere), and satisfying neither is what lets the apps ship
 * without a deletion flow that would have to argue for keeping the hours a
 * person logged. `docs/STORE-RELEASE.md` is the full statement.
 *
 * `signInWithCredential` is the line that creates an account, so the native
 * sign-in asks this first and never reaches that line for an identity with no
 * account (`app/src/auth/google.ts`). Accounts are made on the web, where
 * Google sign-in keeps provisioning a pending account exactly as before.
 *
 * UNAUTHENTICATED, necessarily: there is no session yet, establishing one is
 * what is being gated. That is safe because the caller proves they hold the
 * address by presenting a Google-signed token for it, so this cannot be pointed
 * at an arbitrary email. It answers one boolean and nothing about status or
 * role. It also cannot be done on the client: `fetchSignInMethodsForEmail`
 * returns nothing on projects with email enumeration protection, the default
 * since September 2023, and an Admin SDK callable is Firebase's replacement.
 */

/**
 * Verifies GOOGLE's ID token, not Firebase's. `getAuth().verifyIdToken()`
 * checks tokens Firebase issued; this one comes from `accounts.google.com` for
 * the web OAuth client, because the person has not signed in to Firebase yet.
 */
const oauth = new OAuth2Client();

/**
 * The verified address this token belongs to, or null if it proves none.
 *
 * Under the emulator the token is the unsigned JSON the Auth emulator itself
 * accepts as a Google token (`app/src/auth/devSignIn.ts` makes them), since a
 * Google-signed one cannot be minted locally. It THROWS on unreadable input,
 * as production does, so the two halves of this seam cannot disagree.
 */
async function verifiedEmail(idToken: string): Promise<string | null> {
  if (isEmulatorProject()) {
    const payload = JSON.parse(idToken) as { email?: string; email_verified?: boolean };
    return payload.email_verified === true && payload.email ? payload.email : null;
  }
  // The audience pin stops a token minted for another OAuth client being
  // replayed here; without it any valid Google token would pass.
  const ticket = await oauth.verifyIdToken({ idToken, audience: WEB_CLIENT_ID });
  const payload = ticket.getPayload();
  // An unverified address proves nothing about who holds it.
  return payload?.email_verified === true && payload.email ? payload.email : null;
}

/** The decision, apart from the callable wrapper so it can be tested directly. */
export async function accountExistsFor(idToken: unknown): Promise<{ exists: boolean }> {
  if (typeof idToken !== 'string' || idToken === '') {
    throw new HttpsError('invalid-argument', 'A Google ID token is required.');
  }
  let email: string | null;
  try {
    email = await verifiedEmail(idToken);
  } catch {
    // Opaque, and not reported: a bad token is an ordinary thing for a public
    // endpoint to receive (HttpsErrors never reach Sentry).
    throw new HttpsError('unauthenticated', 'That sign-in could not be verified.');
  }
  if (!email) return { exists: false };

  try {
    await getAuth().getUserByEmail(email);
    return { exists: true };
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/user-not-found') return { exists: false };
    // Anything else is a real failure. Answering `false` would tell a colleague
    // their account is gone because Auth had a bad minute.
    throw e;
  }
}

export const accountExists = onCall(
  { secrets: [sentryDsn] },
  guarded(async (req) => accountExistsFor((req.data as { idToken?: unknown } | null)?.idToken)),
);
