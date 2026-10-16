// Web side of the Google sign-in seam (native sibling: google.ts).
// Works against the Auth emulator too — the popup shows the emulator's fake
// account chooser instead of real Google.
import {
  getRedirectResult,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { ALLOWED_EMAIL_DOMAIN } from '@sabeel/shared';
import { auth } from '../firebase';
import { captureError } from '../sentry';

export const REAL_GOOGLE_AVAILABLE = true;

// A failed signInWithRedirect surfaces ONLY here, on the page load after the
// bounce back — without this call the user silently lands on the sign-in
// screen and nothing reaches Sentry. (Success needs no handling; the auth
// listener picks it up.)
getRedirectResult(auth).catch((e) => captureError(e, { source: 'redirectSignIn' }));

/** Web keeps no Google session of its own — Firebase sign-out is enough. */
export async function googleSignOut(): Promise<void> {}

/**
 * Exchange a Google ID token for a session. The web is where accounts are made,
 * so unlike the native sibling this asks nothing first: an unknown address gets
 * an account, which the onUserCreate trigger provisions as pending. Only the dev
 * sign-in (devSignIn.ts) reaches this; real sign-in uses the popup below.
 */
export async function exchangeGoogleIdToken(idToken: string): Promise<void> {
  await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
}

/**
 * Codes that mean "the person changed their mind", not "sign-in failed".
 * Swallowed here at the seam rather than in each caller, so every caller
 * inherits it and this stays symmetric with google.ts, which has always
 * treated SIGN_IN_CANCELLED / IN_PROGRESS as non-errors. An expected user
 * action must not reach the error reporter, or the issue stream fills with
 * benign events and the real report gets scrolled past.
 */
const CANCELLED = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  // Always show Google's account chooser (with its own "Use another account")
  // instead of silently reusing the last signed-in account. `hd` hints Google to
  // surface org accounts — UX only; the server (auth trigger + rules) enforces.
  provider.setCustomParameters({ prompt: 'select_account', hd: ALLOWED_EMAIL_DOMAIN });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    // Popup unavailable (blocked, or an in-app webview that can't open one)
    // → full-page redirect fallback. Failures of THAT surface only via
    // getRedirectResult above.
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (CANCELLED.has(code)) return; // user closed the chooser — not a failure
    throw e;
  }
}
