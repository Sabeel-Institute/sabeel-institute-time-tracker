export const COLLECTIONS = {
  users: 'users',
  activities: 'activities',
  timeEntries: 'timeEntries',
  timesheets: 'timesheets',
  /** Append-only lifecycle history. Server-written, never client-visible. */
  timesheetEvents: 'timesheetEvents',
} as const;

// Functions region must match setGlobalOptions in functions/src/setup.ts.
export const REGION = 'us-central1';

// Sign-in is restricted to this Google Workspace domain. Enforced server-side by
// the onUserCreate auth trigger (which deletes any account outside it) and by
// firestore.rules (which blocks a non-org account from self-registering a
// profile). The client also passes it to Google as an `hd` hint — UX only; the
// hint is trivially bypassed, so the server checks above are the real gate.
export const ALLOWED_EMAIL_DOMAIN = 'oursabeel.com';

/**
 * The ONE address that may sign in with an email and a password.
 *
 * Everyone else signs in with Google, on the institute's own Workspace accounts.
 * This account exists so an App Store reviewer, who cannot pass Google's sign-in
 * checks for a Workspace account, can open the app (docs/STORE-RELEASE.md,
 * "Review access", decided by Faisal 2026-10-15). It is an ordinary member,
 * made by an administrator, and the server holds it to that:
 *
 *  - blocking functions refuse every password sign-up (an administrator makes
 *    the account with the Admin SDK, which they do not see) and every password
 *    sign-in for any other address (functions/src/signInGate.ts);
 *  - firestore.rules and the callables treat a password session for any other
 *    address as signed out, and a password session as never a manager or an
 *    admin; setUserAccess refuses to promote a password-only account.
 *
 * In this public repo on purpose (decided 2026-10-15): its protection is a long
 * generated password and Firebase's rate limiting, and it can see nothing but
 * its own hours. firestore.rules restates it; signInGate.test.ts holds the two
 * equal.
 */
export const PASSWORD_ACCOUNT_EMAIL = 'apps-reviewer@oursabeel.com';

/**
 * The marker in a sign-in or sign-up the blocking functions refused. It reaches
 * the client inside `auth/internal-error`'s message, and the sign-in screen
 * looks for it to tell that refusal from any other internal error.
 */
export const SIGN_IN_REFUSED = 'SIGN_IN_REFUSED';

// The *Web* OAuth client id (NOT the Android one) — required by native Google
// Sign-In to mint an idToken Firebase accepts. This is the client_type 3 entry
// from app/google-services.json (auto-created when Google sign-in was enabled).
export const WEB_CLIENT_ID =
  '858585609550-4pkumltbrleru9om5q91jhrv1pcnblk9.apps.googleusercontent.com';

/** The Firebase project the app talks to in production (not the emulators'). */
export const FIREBASE_PROJECT_ID = 'sabeel-institute-time-tracker';

/**
 * The app's identity on both phones: the iOS bundle id and the Android package,
 * and so the topic of every push sent to Apple (functions/src/apns.ts), which
 * Apple refuses for any other app's token. projectIdentity.test.ts holds
 * app/app.json and both Firebase config files to it.
 */
export const APP_ID = 'com.sabeelinstitute.timetracker';

// Where the web build is hosted. Used to build the click target of a web push;
// the browser has no app to hand a route to, so the route rides in the URL.
export const WEB_APP_ORIGIN = 'https://sabeel-institute-time-tracker.web.app';

/**
 * The privacy policy and the support page: static files in `app/public/`,
 * served by Hosting outside the signed-in app (`firebase.json` rewrites them
 * ahead of the SPA catch-all), because a store crawler and a reviewer read them
 * without signing in. Apple wants the policy reachable INSIDE the app too
 * (5.1.1(i)), so the sign-in screen and Home link to PRIVACY_URL.
 * `hostingPages.test.ts` holds the paths, the rewrites and the files together.
 */
export const PRIVACY_URL = `${WEB_APP_ORIGIN}/privacy`;
export const SUPPORT_URL = `${WEB_APP_ORIGIN}/support`;

/**
 * The project id the Firebase emulators run as. The app swaps it in for the
 * real one when pointed at the emulators, and the functions recognise the
 * emulator by it: a running project id, unlike an env flag left in a shell,
 * cannot be true in a deploy.
 */
export const EMULATOR_PROJECT_ID = 'demo-sabeel';

/** Clock sessions running longer than this get auto-closed at start + cap. */
export const SESSION_CAP_HOURS = 12;

/** Longest a single entry may claim, mirrored in firestore.rules. */
export const MAX_ENTRY_HOURS = 24;

/**
 * The Android notification channel, named by BOTH sides of the push.
 *
 * Android 8+ posts every notification to a channel, and the channel — not the
 * message — carries the importance, the sound and the per-app switch a person
 * sees in system settings. A send that names no channel is not rejected: it goes
 * to whichever fallback the transport owns (`fcm_fallback_notification_channel`
 * when FCM displays it, expo-notifications' own equivalent when that does), both
 * of which Android labels **"Miscellaneous"**. That is what was happening here —
 * the app created a channel called "Default" that nothing ever posted to,
 * because the server sent no channel id at all. Nothing failed. The
 * notifications arrived, correctly worded, in a drawer nobody recognised.
 *
 * Neither side can check the other at runtime, so the id lives here and both
 * import it. All three Sabeel apps use the same id deliberately; channel ids are
 * namespaced per application, so they cannot collide.
 *
 * HIGH, and right the FIRST time: Android fixes a channel's importance when it
 * is created, and an app may lower it afterwards but may never raise it — only
 * the person can. That is also why this is a NEW id rather than a repair of
 * `'default'`, which already exists at DEFAULT importance on every device that
 * has run the app. See `registerPush` for the deletion of the old one.
 */
export const PUSH_CHANNEL_ID = 'sabeel-alerts';
export const PUSH_CHANNEL_NAME = 'Timesheet alerts and reminders';
