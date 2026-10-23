import { PUSH_CHANNEL_ID, encodeNotifRoute, type NotifRoute } from '@sabeel/shared';

/**
 * FCM error codes that mean "this token will never work again".
 *
 * Anything else (a quota error, a transient outage) must NOT delete the token:
 * pruning on a temporary failure silently unregisters a working device.
 * `messaging/invalid-argument` is deliberately NOT here, though it looks like it
 * belongs: FCM also returns it for a malformed MESSAGE, so one bad payload would
 * come back against every token in the batch and unregister everyone at once.
 * `sabeel-ci check-push` asks FCM about a token that cannot exist and fails
 * unless the answer is one of these.
 */
export const DEAD_TOKEN_CODES: ReadonlySet<string> = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * A notification as FCM carries it to an Android phone or a browser, less the
 * token. The Apple counterpart is `apnsPayload` in apns.ts. Imports nothing
 * relative, so `sabeel-ci check-push` and `send-test-push` load it from source
 * and send exactly this.
 *
 * The tap destination rides in the flat `data` bag, which every surface reads:
 * Android through expo-notifications (verbatim, as long as no key is named
 * `body`), and the browser through the app's own service worker
 * (app/public/firebase-messaging-sw.js), which opens the route itself.
 */
export function fcmMessage(message: { title: string; body: string; route: NotifRoute | null }) {
  return {
    notification: { title: message.title, body: message.body },
    data: message.route ? encodeNotifRoute(message.route) : {},
    // Name the channel on EVERY send. Without this FCM posts to its own fallback
    // channel, which Android labels "Miscellaneous", and the channel the app
    // created is never addressed by anything — see PUSH_CHANNEL_ID. Nothing
    // errors either side, so only the payload can hold this honest.
    android: { notification: { channelId: PUSH_CHANNEL_ID } },
  };
}
