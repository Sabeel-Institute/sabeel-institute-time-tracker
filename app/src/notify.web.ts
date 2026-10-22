// Web push registration. Uses the Web Push certificate's public key
// (VAPID_PUBLIC_KEY, committed in firebase-config.ts) and the service worker at
// /firebase-messaging-sw.js (app/public/). Never throws.
//
// It also needs a third thing that is not configuration: permission has to be
// asked FROM A PRESS. Signing in is not one — see enablePush.
import { useEffect } from 'react';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { COLLECTIONS, decodeNotifRoute, type PushTokenDoc } from '@sabeel/shared';
import { app, db } from './firebase';
import { VAPID_PUBLIC_KEY } from './firebase-config';
import { USE_EMULATORS } from './env';
import { openNotifRoute } from './notifRouting';
import { captureError } from './sentry';

/**
 * Route notification taps. A browser can't hand the page a payload — clicking a
 * web push just opens fcm_options.link — so the route arrives as the query
 * string and is stripped once read, otherwise a reload would re-navigate.
 */
export function useNotifTaps(): void {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (![...params.keys()].length) return;
    const route = decodeNotifRoute(Object.fromEntries(params));
    window.history.replaceState({}, '', window.location.pathname);
    if (route) openNotifRoute(route);
  }, []);
}

/**
 * The checks that can be made WITHOUT awaiting anything.
 *
 * This is the synchronous half of `isSupported()`, split out because of the
 * rule in `enablePush`: nothing may be awaited before the permission request.
 * The asynchronous half — `isSupported()`'s IndexedDB probe, which only catches
 * Firefox private browsing and Safari in an iframe — runs after the prompt,
 * where an await costs nothing.
 *
 * Deliberately says nothing about USE_EMULATORS. What a BROWSER can do does not
 * depend on which Firebase backend it is pointed at, and folding the emulator
 * flag in here made the whole notification UI read 'unsupported' in every local
 * run — so the one control this file exists for could not be seen, screenshotted
 * or toured by the screens sweep. The emulator gate belongs on registration,
 * where the real constraint is; see claimToken.
 */
function canRequestPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * What the notification settings screen should offer: ask, explain, or say
 * nothing can be done here. Read on mount, never in a press handler — it awaits.
 */
/**
 * A browser deliberately offers no way to open its own site settings — the
 * permission would be worth little if a site could reach past it. So a blocked
 * browser gets told where to look instead of a button that cannot work.
 */
export const canOpenPushSettings = false;

export function openPushSettings(): void {}

/**
 * What came of asking. Three outcomes, not a boolean: permission granted but no
 * token — a browser pointed at the emulators, a service worker that failed to
 * activate — is not a refusal, and telling someone their notifications are
 * "turned off" when they just said yes sends them to fix a setting that is
 * already correct.
 */
export type PushEnableResult = 'granted' | 'denied' | 'unavailable';

export async function pushPromptState(): Promise<
  'granted' | 'denied' | 'default' | 'unsupported'
> {
  if (!canRequestPush()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return (await isSupported().catch(() => false)) ? 'default' : 'unsupported';
}

/**
 * Register this browser for push if it is ALREADY permitted. Never prompts.
 *
 * This is the sign-in path. It used to ask for permission here, which is the
 * bug: a browser only honours a permission request that follows a press, and
 * signing in reaches this from an effect keyed on the active uid. Safari
 * refused it outright and Chrome demoted it to the quiet chip, so on any new
 * browser permission stayed at 'default' and the site appeared in neither the
 * allowed nor the blocked list — the tell-tale symptom of a request nobody saw.
 *
 * Asking now belongs to `enablePush`, reached from a press — the nudge on Home,
 * or the notification settings screen itself. A
 * browser permitted in an earlier visit still registers silently right here, so
 * every already-working device keeps working with no extra press.
 *
 * Returns whether a token is now on file — NOT merely whether permission was
 * granted. The settings screen needs the difference: permission granted with no
 * token behind it (a worker that failed to activate) must not be reported as
 * "enabled", or the screen is showing a switch with nothing behind it.
 */
export async function registerPush(uid: string): Promise<boolean> {
  if (!canRequestPush() || Notification.permission !== 'granted') return false;
  try {
    return await claimToken(uid);
  } catch (e) {
    captureError(e, { source: 'registerPush' });
    return false;
  }
}

/**
 * Ask for permission and register — the ONLY function that may prompt.
 *
 * Call it as the first statement of a press handler and never await anything
 * before it. `Notification.requestPermission()` consumes transient activation
 * in WebKit, which honours it only as the direct result of a click, and an
 * await in between is enough to lose it: `isSupported()` used to run first, and
 * it awaits an IndexedDB `open()` that resolves from an `onsuccess` TASK, so
 * the request landed a whole event-loop turn after the press.
 *
 * An async function runs synchronously up to its first await, so the request
 * below is raised inside the press as long as every caller in the chain also
 * calls straight through. notify.web.test.ts holds that property down.
 */
export async function enablePush(uid: string): Promise<PushEnableResult> {
  if (!canRequestPush()) return 'unavailable';

  // Inside the try, but still the first thing that runs: entering a try block
  // is synchronous, so this keeps the request inside the press AND catches a
  // synchronous throw. Outside it, a throw here escaped a function every caller
  // treats as total, leaving a button stuck in its busy state.
  try {
    // NOTHING MAY BE AWAITED ABOVE THIS LINE.
    const decision =
      Notification.permission === 'default'
        ? Notification.requestPermission()
        : Promise.resolve(Notification.permission);

    // Past the prompt, awaits are free again.
    if ((await decision) !== 'granted') return 'denied';
    return (await claimToken(uid)) ? 'granted' : 'unavailable';
  } catch (e) {
    captureError(e, { source: 'enablePush' });
    return 'unavailable';
  }
}

/**
 * Take the FCM token for this browser and file it under the user.
 *
 * Callers have already established permission; this half may await freely.
 */
async function claimToken(uid: string): Promise<boolean> {
  // FCM has no emulator. A token minted against the demo project could never be
  // delivered to and would make local runs non-deterministic — so registration
  // stops here, while the UI above still reports what this browser can actually
  // do. That split is deliberate: it keeps the notification screen reviewable
  // locally without pretending a local device can receive a push.
  if (USE_EMULATORS) return false;
  if (!(await isSupported().catch(() => false))) return false;
  await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  // `register()` resolves as soon as the script is FETCHED, not once a worker is
  // running it. Handing that registration straight to getToken fails with
  // "Subscription failed - no active Service Worker" — on a first-ever visit
  // only, because every later load already has one activated. `ready` waits for
  // an active worker in this page's scope.
  //
  // Raced against a timeout because `ready` never REJECTS: a worker that fails
  // to activate leaves it pending forever, and the caller would wait for it with
  // nothing to show and no error.
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]);
  if (!registration) return false;
  const token = await getToken(getMessaging(app), {
    vapidKey: VAPID_PUBLIC_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) return false;
  const body: PushTokenDoc = { token, platform: 'web', updatedAt: Date.now() };
  await setDoc(doc(db, COLLECTIONS.users, uid, 'pushTokens', token), body);
  return true;
}

/**
 * Called on sign-out: pushes target the DEVICE/browser, not the session, so
 * without this a shared browser keeps getting the previous account's
 * notifications. getToken here never prompts — the permission check above it is
 * synchronous and bails before anything is asked, and if permission was granted
 * it returns the existing token.
 */
export async function unregisterPush(uid: string): Promise<void> {
  if (USE_EMULATORS) return;
  if (!canRequestPush() || Notification.permission !== 'granted') return;
  try {
    if (!(await isSupported().catch(() => false))) return;
    const sw = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: sw,
    });
    if (!token) return;
    await deleteDoc(doc(db, COLLECTIONS.users, uid, 'pushTokens', token));
  } catch {
    // Nothing registered, nothing to do.
  }
}
