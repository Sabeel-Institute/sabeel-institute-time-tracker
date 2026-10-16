import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The NATIVE half of the push seam.
 *
 * It had no tests at all, which is how two real defects survived a full review:
 * `enablePush` ignored what `registerPush` returned, so a device that granted
 * permission but filed no token was reported as enabled; and `pushPromptState`
 * answered 'unsupported' whenever the app pointed at the emulators, which hid
 * the whole control from every local run. Both are asserted below.
 */
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(() => Promise.resolve()),
  deleteNotificationChannelAsync: vi.fn(() => Promise.resolve()),
  requestPermissionsAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  getDevicePushTokenAsync: vi.fn(),
  addPushTokenListener: vi.fn(() => ({ remove: vi.fn() })),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
}));
const rn = vi.hoisted(() => ({ Platform: { OS: 'android' as 'android' | 'ios' } }));
vi.mock('react-native', () => ({ Linking: { openSettings: vi.fn(() => Promise.resolve()) }, Platform: rn.Platform }));
const app = vi.hoisted(() => ({ profile: 'development' as string | null, release: 0 }));
vi.mock('expo-application', () => ({
  ApplicationReleaseType: { UNKNOWN: 0, SIMULATOR: 1 },
  getIosPushNotificationServiceEnvironmentAsync: vi.fn(async () => app.profile),
  getIosApplicationReleaseTypeAsync: vi.fn(async () => app.release),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  setDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
}));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./env', () => ({ USE_EMULATORS: false }));
vi.mock('./sentry', () => ({ captureError: vi.fn() }));
vi.mock('./notifRouting', () => ({ openNotifRoute: vi.fn() }));

import * as Notifications from 'expo-notifications';
import { setDoc } from 'firebase/firestore';
import { PUSH_CHANNEL_ID, PUSH_CHANNEL_NAME } from '@sabeel/shared';
import { enablePush, pushPromptState, registerPush } from './notify';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function device(opts: { granted: boolean; canAskAgain?: boolean; token?: string | null }) {
  const perm = { granted: opts.granted, canAskAgain: opts.canAskAgain ?? true };
  asMock(Notifications.getPermissionsAsync).mockResolvedValue(perm);
  asMock(Notifications.requestPermissionsAsync).mockResolvedValue(perm);
  asMock(Notifications.getDevicePushTokenAsync).mockResolvedValue({
    data: opts.token === undefined ? 'fcm-native-token' : opts.token,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rn.Platform.OS = 'android';
  app.profile = 'development';
  app.release = 0;
});

describe('registerPush', () => {
  it('reports the token landing, not merely the permission', async () => {
    device({ granted: true });
    await expect(registerPush('user-1')).resolves.toBe(true);
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('reports false when the device yields no token', async () => {
    device({ granted: true, token: null });
    await expect(registerPush('user-1')).resolves.toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('reports false when permission is refused', async () => {
    device({ granted: false });
    await expect(registerPush('user-1')).resolves.toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  /**
   * Sign-in registers a device that already allows notifications and ASKS
   * NOTHING. On an iPhone the prompt can be shown once; spent at sign-in, before
   * the person knows what the app sends, a "Don't Allow" leaves push dead until
   * Settings. The ask belongs to a press (enablePush).
   */
  it('never raises the permission prompt by itself', async () => {
    device({ granted: false, canAskAgain: true });
    await expect(registerPush('user-1')).resolves.toBe(false);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('files an Android row for an FCM token', async () => {
    device({ granted: true });
    await registerPush('user-1');
    expect(asMock(setDoc).mock.calls[0][1]).toEqual({
      token: 'fcm-native-token',
      platform: 'android',
      updatedAt: expect.any(Number),
    });
  });
});

/**
 * An iPhone's token is Apple's, and the server sends it to whichever of Apple's
 * two services issued it (functions/src/apns.ts), so the row must say which.
 */
describe('registerPush on an iPhone', () => {
  const row = async () => {
    rn.Platform.OS = 'ios';
    device({ granted: true, token: 'ab'.repeat(32) });
    await registerPush('user-1');
    return asMock(setDoc).mock.calls[0][1];
  };

  it('files an iOS row naming the service the profile says', async () => {
    app.profile = 'production';
    expect(await row()).toEqual({
      token: 'ab'.repeat(32),
      platform: 'ios',
      apnsEnvironment: 'production',
      updatedAt: expect.any(Number),
    });
  });

  it('takes the sandbox for a simulator, which carries no profile', async () => {
    app.profile = null;
    app.release = 1; // SIMULATOR
    expect(await row()).toMatchObject({ apnsEnvironment: 'development' });
  });

  it('takes production for a store install, which carries no profile either', async () => {
    app.profile = null;
    app.release = 0;
    expect(await row()).toMatchObject({ apnsEnvironment: 'production' });
  });
});

/**
 * The CLIENT half of the notification channel contract; the server half is
 * functions/test/unit/pushChannel.test.ts.
 *
 * The app used to create a channel called 'default' at DEFAULT importance that
 * nothing ever posted to, because no send named a channel at all — so every
 * notification went to the transport's fallback, which Android labels
 * "Miscellaneous", and the channel here existed purely as a switch that did
 * nothing. Neither side can check the other at runtime and nothing errors, so
 * the two halves are pinned separately, in the code each one lives in.
 *
 * Reading PUSH_CHANNEL_ID rather than restating it means this cannot catch a
 * genuine disagreement between the halves. What it catches is the id being
 * dropped or a literal creeping back in, which is the failure that happened.
 */
describe('the notification channel', () => {

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
  expect(PUSH_CHANNEL_NAME).toMatch(/\S/);
});
  it('is created under the shared id, at the importance the server assumes', async () => {
    device({ granted: true });
    await registerPush('user-1');
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(PUSH_CHANNEL_ID, {
      name: PUSH_CHANNEL_NAME,
      importance: Notifications.AndroidImportance.HIGH,
    });
  });

  /**
   * BEFORE the token, or the first message can arrive at a channel that does
   * not exist yet. The ORDER is the assertion — both calls having happened, in
   * either order, would satisfy a naive check.
   */
  it('exists before any token is handed over', async () => {
    device({ granted: true });
    await registerPush('user-1');
    const channelAt = asMock(Notifications.setNotificationChannelAsync).mock
      .invocationCallOrder[0];
    const tokenAt = asMock(Notifications.getDevicePushTokenAsync).mock.invocationCallOrder[0];
    expect(channelAt).toBeLessThan(tokenAt);
  });

  /**
   * Android fixes a channel's importance at creation and an app may never raise
   * it afterwards, so 'default' cannot be repaired in place on any device that
   * has already run the app — it is replaced. Left behind, it lingers in the
   * system settings as a second, permanently silent entry someone would
   * reasonably try to configure.
   */
  it('removes every channel it has retired, not just its own', async () => {
    device({ granted: true });
    await registerPush('user-1');
    const deleted = asMock(Notifications.deleteNotificationChannelAsync).mock.calls.flat();
    // Ours, which nothing ever posted to.
    expect(deleted).toContain('default');
    // And the two the TRANSPORTS invented while no send named a channel. Android
    // labels both "Miscellaneous", which is why a device that ran the old build
    // shows two identical entries by that name — the exact "switch that does
    // nothing" this whole change exists to remove.
    expect(deleted).toContain('fcm_fallback_notification_channel');
    expect(deleted).toContain('expo_notifications_fallback_notification_channel');
  });
});

describe('enablePush', () => {
  /**
   * The defect this is here for: it used to discard registerPush's result and
   * answer from the permission alone, so a granted device with no token behind
   * it was reported as 'granted' — a switch with nothing behind it.
   */
  it('is granted only when a token actually landed', async () => {
    device({ granted: true });
    await expect(enablePush('user-1')).resolves.toBe('granted');
  });

  it('is what raises the permission prompt', async () => {
    device({ granted: false, canAskAgain: true });
    await enablePush('user-1');
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('is unavailable when permission was granted but no token landed', async () => {
    device({ granted: true, token: null });
    await expect(enablePush('user-1')).resolves.toBe('unavailable');
  });

  it('is denied when the dialog was refused for good', async () => {
    device({ granted: false, canAskAgain: false });
    await expect(enablePush('user-1')).resolves.toBe('denied');
  });

  it('is denied — still askable — when the dialog was merely dismissed', async () => {
    device({ granted: false, canAskAgain: true });
    await expect(enablePush('user-1')).resolves.toBe('denied');
  });
});

/**
 * The emulator flag gates REGISTRATION, never the UI state — the same split the
 * web sibling makes. Folding it into pushPromptState made the notifications
 * screen read 'unsupported' in every emulator-backed run, hiding the control.
 */
describe('against the emulators', () => {
  async function loadWithEmulators() {
    vi.resetModules();
    vi.doMock('./env', () => ({ USE_EMULATORS: true }));
    const mod = await import('./notify');
    vi.doUnmock('./env');
    return mod;
  }

  it('still reports what the DEVICE will permit', async () => {
    device({ granted: false, canAskAgain: true });
    const { pushPromptState: state } = await loadWithEmulators();
    await expect(state()).resolves.toBe('default');
  });

  it('files no Android token: there is no FCM emulator to deliver to', async () => {
    device({ granted: true });
    const { registerPush: reg } = await loadWithEmulators();
    await expect(reg('user-1')).resolves.toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('files an iPhone token: Apple’s sandbox does deliver to the simulator', async () => {
    rn.Platform.OS = 'ios';
    device({ granted: true, token: 'ab'.repeat(32) });
    const { registerPush: reg } = await loadWithEmulators();
    await expect(reg('user-1')).resolves.toBe(true);
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  /**
   * The gate sits BELOW the channel setup and the prompt, and this is what says
   * so. With it on the first line of registerPush — where it was — an
   * emulator-backed build could never create the channel or raise the system
   * dialog even once. That is the only build that reaches the AVD outside a
   * release, so the one native surface a browser cannot reach was unverifiable
   * from the only place it can be looked at, and PUSH_CHANNEL_ID's importance
   * with it.
   */
  it('still sets the channel up, and asks, before stopping at the token', async () => {
    device({ granted: true });
    const { registerPush: reg } = await loadWithEmulators();
    await reg('user-1', true);
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      PUSH_CHANNEL_ID,
      expect.objectContaining({ importance: Notifications.AndroidImportance.HIGH }),
    );
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });
});

describe('pushPromptState', () => {
  it('reports a device that can still be asked', async () => {
    device({ granted: false, canAskAgain: true });
    await expect(pushPromptState()).resolves.toBe('default');
  });

  it('reports a spent prompt as denied', async () => {
    device({ granted: false, canAskAgain: false });
    await expect(pushPromptState()).resolves.toBe('denied');
  });

  it('reports granted', async () => {
    device({ granted: true });
    await expect(pushPromptState()).resolves.toBe('granted');
  });
});
