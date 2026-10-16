import { beforeUserCreated, beforeUserSignedIn, HttpsError } from 'firebase-functions/v2/identity';
import { logger } from 'firebase-functions/v2';
import { PASSWORD_ACCOUNT_EMAIL, SIGN_IN_REFUSED } from '@sabeel/shared';

/**
 * The email-and-password door, held shut at the auth layer.
 *
 * Email/Password sign-in is enabled for one account (PASSWORD_ACCOUNT_EMAIL),
 * and enabling it opens the public Identity Toolkit API to anyone holding the
 * web API key, app or no app: `accounts:signUp` with any address and password
 * would make an account. These two blocking functions close that before any
 * account exists. They need the project on Identity Platform (it is, since
 * 2026-10-15) and are registered with it by `firebase deploy`.
 *
 *  - beforeSignUp refuses EVERY password sign-up. The one password account is
 *    made by an administrator with the Admin SDK, which blocking functions do
 *    not see (proved against the emulator: signInGate.gate.test.ts). Google
 *    sign-ups pass, as before: onUserCreate keeps deleting a non-org one.
 *  - beforeSignIn refuses a password sign-in for any address but the one, so
 *    a second password account made by mistake cannot sign in at all.
 *
 * The rules and the callables apply their own locks too (PASSWORD_ACCOUNT_EMAIL).
 *
 * Both run on every sign-up and sign-in, Google ones included, and Identity
 * Platform gives a blocking function 7 seconds, cold start included.
 */

/** Why a sign-up is refused, or null. Pure, for signInGate.test.ts. */
export function refusedSignUp(providerId: string | null): string | null {
  if (providerId === 'password') return 'password sign-up';
  return null;
}

/** Why a sign-in is refused, or null. */
export function refusedSignIn(providerId: string | null, email: string | null | undefined): string | null {
  if (providerId === 'password' && (email ?? '').toLowerCase() !== PASSWORD_ACCOUNT_EMAIL) return 'password sign-in';
  return null;
}

function refuse(reason: string, email: string | undefined): never {
  logger.warn('Refused at the auth gate', { reason, email: email ?? null });
  throw new HttpsError('permission-denied', `${SIGN_IN_REFUSED}: ${reason}`);
}

export const beforeSignUp = beforeUserCreated((event) => {
  const reason = refusedSignUp(event.additionalUserInfo?.providerId ?? null);
  if (reason) refuse(reason, event.data?.email);
});

export const beforeSignIn = beforeUserSignedIn((event) => {
  const reason = refusedSignIn(event.additionalUserInfo?.providerId ?? null, event.data?.email);
  if (reason) refuse(reason, event.data?.email);
});
