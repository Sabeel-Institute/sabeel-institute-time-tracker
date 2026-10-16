// Native side of the Google sign-in seam, iOS and Android (web sibling:
// google.web.ts). Uses the native Google Sign-In SDK to get an ID token, then
// exchanges it for a Firebase session, refusing an identity that has no account
// (exchangeGoogleIdToken, below). On Android this needs the debug/release SHA-1
// registered on the Firebase Android app and WEB_CLIENT_ID set (see TODO.md);
// otherwise Google returns a DEVELOPER_ERROR. On iOS the SDK reads CLIENT_ID
// from the bundled GoogleService-Info.plist.
import {
  GoogleSignin,
  statusCodes,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { ALLOWED_EMAIL_DOMAIN, WEB_CLIENT_ID } from '@sabeel/shared';
import { auth, functions } from '../firebase';

export const REAL_GOOGLE_AVAILABLE = true;

let configured = false;
function ensureConfigured() {
  if (configured) return;
  // webClientId MUST be the *Web* OAuth client id (not the Android or iOS one):
  // it is the audience of the ID token, which Firebase and accountExists check.
  // hostedDomain hints Google to offer only org accounts — UX only; the server
  // (auth trigger + rules) is the real gate.
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, hostedDomain: ALLOWED_EMAIL_DOMAIN });
  configured = true;
}

/**
 * Clear the remembered Google account. Without this, the next signIn() silently
 * reuses the previous account and there is no way to switch users — sign-out
 * from the app must also sign out of Google so the account chooser reappears.
 */
export async function googleSignOut(): Promise<void> {
  ensureConfigured();
  await GoogleSignin.signOut();
}

const accountExists = httpsCallable<{ idToken: string }, { exists: boolean }>(
  functions,
  'accountExists',
);

/** The identity has no account; the sign-in screen turns `code` into its copy. */
class NoAccountError extends Error {
  readonly code = 'auth/no-account';
  constructor() {
    super('No account for that sign-in.');
    this.name = 'NoAccountError';
  }
}

/**
 * THIS APP DOES NOT CREATE ACCOUNTS, AND MUST NOT LEARN HOW.
 *
 * `signInWithCredential` is the line that would create one (the onUserCreate
 * trigger then provisions it), so nothing may reach it until an account is known
 * to exist. A Google ID token is pure Google OAuth and touches nothing in this
 * Firebase project, which is the only reason there is a window to ask in.
 *
 * There is deliberately no sign-up affordance in this app, and the refusal names
 * no website. Both stores stop requiring in-app account deletion only while the
 * app neither creates an account nor points at somewhere that does, and "sign in
 * on the website first" is the second of those triggers stated almost verbatim.
 * That instruction belongs in the onboarding (the user manual, the support
 * page), out of band. Read docs/STORE-RELEASE.md before adding anything
 * friendlier here.
 *
 * The dev sign-in (devSignIn.ts) comes through here too, so an emulator build on
 * a phone refuses an unknown address exactly as production does. The web half of
 * the seam (google.web.ts) keeps creating accounts, which is why nothing here has
 * to detect a platform.
 */
export async function exchangeGoogleIdToken(idToken: string): Promise<void> {
  const { data } = await accountExists({ idToken });
  if (!data.exists) throw new NoAccountError();
  await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
}

export async function signInWithGoogle(): Promise<void> {
  ensureConfigured();
  try {
    // A no-op on iOS, which has no Play services.
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) {
      // User dismissed the account chooser — not an error worth surfacing.
      return;
    }
    const idToken = response.data.idToken;
    if (!idToken) {
      throw new Error('Google sign-in returned no ID token.');
    }
    try {
      await exchangeGoogleIdToken(idToken);
    } catch (e) {
      // Google still remembers the chosen account, and signIn() would silently
      // reuse it, so somebody who picked the wrong one could never switch.
      if (e instanceof NoAccountError) await googleSignOut().catch(() => undefined);
      throw e;
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) {
      return; // user cancelled / a sign-in is already running
    }
    if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play services are required to sign in.');
    }
    throw e;
  }
}
