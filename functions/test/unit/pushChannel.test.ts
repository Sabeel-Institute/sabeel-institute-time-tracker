import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PUSH_CHANNEL_ID } from '@sabeel/shared';

/**
 * The SERVER half of the notification channel contract.
 *
 * Android posts every notification to a channel, and a send that names none is
 * not rejected — it lands in the transport's fallback, which the settings UI
 * labels "Miscellaneous", while the channel the app created sits addressed by
 * nothing. That is exactly what shipped: `sendEachForMulticast` carried a
 * `notification` block and no `android` block at all. Nothing errored, nothing
 * logged, and the notifications arrived correctly worded in the wrong drawer.
 *
 * WHAT MAKES THIS GO RED, because three obvious checks cannot:
 *   - asserting the client calls setNotificationChannelAsync proves one half of
 *     a two-half contract;
 *   - asserting the send succeeded proves nothing — FCM returns a message id
 *     whatever channel is named, including none;
 *   - asserting a notification arrived on a device proves nothing — it does
 *     arrive, in the wrong place.
 * So this asserts the PAYLOAD handed to FCM, through the real trigger. Delete
 * the `android` block in functions/src/fcm.ts and this fails.
 *
 * It reads PUSH_CHANNEL_ID rather than restating it, so it cannot catch the
 * client and server genuinely disagreeing — nothing in a repo can, since the
 * two never meet until a device renders one. What it does catch is the field
 * being dropped, or a literal creeping back in, which is the failure that
 * actually happened. The other half is pinned in app/src/notify.test.ts.
 */

const sendEachForMulticast = vi.fn(async (msg: unknown) => {
  void msg;
  return { responses: [{ success: true }], successCount: 1, failureCount: 0 };
});

const tokenDoc = {
  id: 'device-token-1',
  data: () => ({ token: 'device-token-1', platform: 'android', updatedAt: 1 }),
  ref: { delete: vi.fn(async () => undefined) },
};
const adminDoc = {
  id: 'admin-1',
  data: () => ({ displayName: 'Amina', email: 'amina@example.test', admin: true, status: 'active' }),
};

// One fake collection object serves both reads the trigger makes: the admin
// query (`.where(...).where(...).get()`) and the token subcollection
// (`.doc(uid).collection('pushTokens').get()`).
const usersCollection: Record<string, unknown> = {
  get: async () => ({ docs: [adminDoc], empty: false, size: 1 }),
  doc: () => ({
    collection: () => ({ get: async () => ({ docs: [tokenDoc], empty: false }) }),
  }),
};
usersCollection.where = () => usersCollection;

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => usersCollection }),
}));
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast }),
}));

import { notifyNewUser } from '../../src/notify';

type Multicast = {
  tokens: string[];
  notification?: { title?: string; body?: string };
  android?: { notification?: { channelId?: string } };
};

const newUserEvent = {
  params: { uid: 'new-user' },
  data: {
    data: () => ({
      displayName: 'Bilal',
      email: 'bilal@example.test',
      status: 'pending',
    }),
  },
};

async function fire(): Promise<Multicast> {
  await (notifyNewUser as unknown as { run: (e: unknown) => Promise<void> }).run(newUserEvent);
  expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
  return sendEachForMulticast.mock.calls[0][0] as Multicast;
}

beforeEach(() => vi.clearAllMocks());

describe('the push payload', () => {

/**
 * The constant has a VALUE.
 *
 * Both workspaces resolve `@sabeel/shared` to its BUILT `lib/`, not to `src/`,
 * so a run that skips the build sees `undefined` — and every assertion below
 * then compares undefined to undefined and passes while proving nothing. That
 * happened on the first run of these tests. `npm test` builds first; a bare
 * `npx vitest` does not.
 */
it('is a real id, not an undefined import', () => {
  expect(PUSH_CHANNEL_ID).toMatch(/\S/);
});
  it('names the channel the app created', async () => {
    const msg = await fire();
    expect(msg.android?.notification?.channelId).toBe(PUSH_CHANNEL_ID);
  });

  /**
   * Guards the shape as well as the value. `android.notification.channelId` is
   * three levels deep and admin-SDK messages accept unknown top-level keys
   * without complaint, so a channelId parked one level out — or under
   * `android.data` — would send exactly as before and this is what notices.
   */
  it('carries it alongside the message, not instead of it', async () => {
    const msg = await fire();
    expect(msg.tokens).toEqual(['device-token-1']);
    expect(msg.notification?.title).toBeTruthy();
    expect(Object.keys(msg.android ?? {})).toEqual(['notification']);
  });
});

/**
 * The manifest's notification icons. Its default channel, the one place the
 * channel id is restated as a literal, is held to PUSH_CHANNEL_ID by
 * `sabeel-ci check-app`.
 */
describe('the manifest', () => {
  const MANIFEST = resolve(
    import.meta.dirname,
    '../../../app/android/app/src/main/AndroidManifest.xml',
  );
  const manifest = () => readFileSync(MANIFEST, 'utf8');

  /**
   * Both icon pairs, because two different things draw a notification here and
   * each reads only its own keys: FCM's SDK when a payload arrives backgrounded,
   * expo-notifications for foreground and local ones. One pair alone leaves half
   * of them on the launcher icon's silhouette — a featureless ring.
   */
  it('points both renderers at the same icon and tint', () => {
    const keys = [...manifest().matchAll(/android:name="([^"]*default_notification_(?:icon|color))"/g)]
      .map((m) => m[1])
      .sort();
    expect(keys).toEqual([
      'com.google.firebase.messaging.default_notification_color',
      'com.google.firebase.messaging.default_notification_icon',
      'expo.modules.notifications.default_notification_color',
      'expo.modules.notifications.default_notification_icon',
    ]);
  });
});
