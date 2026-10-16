// Emulator-only: the Auth emulator accepts an unsigned JSON payload as a Google
// idToken, so we can exercise the exact production credential path without real
// OAuth: the platform's own exchangeGoogleIdToken, which on a phone asks
// accountExists first and refuses an address with no account, and on the web
// creates one. Works on every platform; the UI only offers it when
// USE_EMULATORS is set.
import { exchangeGoogleIdToken } from './google';

export async function devSignInAsGoogle(email: string, name: string): Promise<void> {
  const sub = `dev-${email.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  const idToken = JSON.stringify({
    sub,
    email,
    email_verified: true,
    name,
  });
  await exchangeGoogleIdToken(idToken);
}
