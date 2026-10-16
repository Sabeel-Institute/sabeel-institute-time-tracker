/**
 * The sentence the sign-in screen shows for a failed sign-in, and whether the
 * failure is worth reporting. Pure, so the copy and the rule are unit-tested
 * (signInMessage.test.ts) away from the screen.
 */
import { SIGN_IN_REFUSED } from '@sabeel/shared';

/**
 * The phone app's refusal of an identity with no account (google.ts).
 *
 * NAMES NO WEBSITE, ON PURPOSE. The honest instruction, "sign in on the website
 * first", is the exact sentence Google Play's second account-creation trigger
 * forbids, and saying it would oblige this app to ship an account-deletion flow.
 * The instruction lives in the user manual and on the support page instead. See
 * docs/STORE-RELEASE.md.
 */
export const NO_ACCOUNT_MESSAGE = "This account isn't set up for the app yet. Contact your administrator.";

const UNREACHABLE_MESSAGE = 'Could not reach the server. Check your connection and try again.';

/**
 * One sentence for every way an email and password can fail to sign in: a
 * wrong password, no such account, and an address the server refuses to let
 * sign in with a password at all. Telling them apart would tell a stranger
 * which addresses have accounts.
 */
const NO_MATCH_MESSAGE = 'That email and password do not match an account.';

export function signInMessage(e: unknown): { text: string; report: boolean } {
  const code = (e as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/no-account':
      // An answer, not a failure: nothing to report.
      return { text: NO_ACCOUNT_MESSAGE, report: false };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
    case 'auth/missing-password':
      return { text: NO_MATCH_MESSAGE, report: false };
    case 'auth/internal-error':
      // The sign-in gate's refusal travels inside this code's message; any
      // other internal error is a real fault, and says so in its own words.
      return String((e as { message?: unknown }).message ?? '').includes(SIGN_IN_REFUSED)
        ? { text: NO_MATCH_MESSAGE, report: false }
        : { text: (e as Error).message || 'Sign-in failed. Try again.', report: true };
    case 'auth/too-many-requests':
      return { text: 'Too many attempts. Wait a few minutes and try again.', report: false };
    case 'auth/network-request-failed':
    case 'functions/unavailable':
    case 'functions/deadline-exceeded':
      return { text: UNREACHABLE_MESSAGE, report: false };
    case 'functions/internal':
      // The functions SDK reports a server it could not reach as the bare word
      // "internal"; that is no sentence to show anybody. Reported, because it
      // can also be a real fault.
      return { text: UNREACHABLE_MESSAGE, report: true };
    default:
      return { text: (e as Error).message || 'Sign-in failed. Try again.', report: true };
  }
}
