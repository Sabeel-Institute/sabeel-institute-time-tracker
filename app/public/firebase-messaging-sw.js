/* global self, clients */
/*
 * Service worker for web push.
 *
 * A browser cannot be woken by a push without one: when the tab is closed or
 * backgrounded there is no page running, so the push service hands the message
 * to this worker instead. It must sit at the ORIGIN ROOT (expo export copies
 * app/public/ into the bundle): a worker under a subdirectory can only receive
 * events for that subdirectory.
 *
 * It handles the `push` event ITSELF, without the Firebase messaging SDK, and
 * loads no outside script. The SDK's worker shows a push only while no tab of
 * the app is visible and drops one arriving at a focused tab unless the page
 * draws it; this one shows every push, whether the app is in the foreground,
 * the background or closed. Minting the token (`notify.web.ts`) needs only a
 * registration, not a Firebase-aware worker, so there is no copy of the
 * Firebase config here either.
 *
 * The payload is FCM's web push JSON: `notification` (title, body) and `data`,
 * which is the push's route as flat strings (`encodeNotifRoute`). A tap opens
 * that route. `functions/test/unit/firebaseMessagingSw.test.ts` runs this file
 * in a fake worker scope; `scripts/push-e2e.mjs` delivers a real push of every
 * kind to it in Chromium and follows each tap to its screen.
 */

const APP_NAME = 'Sabeel Time Tracker';

// Take over as soon as a new version of this file is installed. A worker waits
// by default until every tab of the app is closed, which for someone who keeps
// a tab open means weeks on the previous worker; this one intercepts no
// fetches, so there is nothing an open page could be part-way through with the
// old one.
self.addEventListener('install', () => self.skipWaiting());

/** FCM's JSON body, or null for a push that is not one (nothing else sends any). */
function readPayload(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  if (!payload) return;
  const { title, body } = payload.notification ?? {};
  const data = payload.data ?? {};
  event.waitUntil(
    self.registration.showNotification(title ?? APP_NAME, {
      body: body ?? '',
      icon: '/favicon.ico',
      // An exact repeat collapses into one banner rather than stacking.
      tag: `${title ?? APP_NAME}|${body ?? ''}`,
      data,
    }),
  );
});

/**
 * The address that opens a notification's route in a new tab: the app's root
 * with the route's fields as the query, which the app reads on launch and
 * strips (`useNotifTaps` in notify.web.ts, `decodeNotifRoute`).
 */
function subjectUrl(data) {
  const query = Object.keys(data)
    .filter((key) => typeof data[key] === 'string')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join('&');
  return query ? `/?${query}` : '/';
}

/**
 * A tapped notification opens its route. A tab of the app already open is
 * told where to go and brought forward (one app, not a second copy beside
 * it); with none open, a new one opens at `subjectUrl`. The message is posted
 * before focusing, so a refused focus cannot cost the navigation.
 */
async function openSubject(data) {
  const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = wins.find((w) => w.url.startsWith(self.location.origin));
  if (!open) return clients.openWindow(subjectUrl(data));
  open.postMessage({ type: 'push-open', data });
  return open.focus().catch(() => undefined);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openSubject(event.notification.data ?? {}));
});
